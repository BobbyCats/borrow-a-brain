import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash, sign} from 'node:crypto';
import {fileMap} from '../skills/bab/scripts/install.mjs';
import {verifyBundle} from '../skills/bab/scripts/update.mjs';
import {validateConfig} from '../skills/bab/scripts/config.mjs';
import {isWithin} from '../skills/bab/scripts/store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const variants = {
  'mac-arm64': {system: 'mac', arch: 'arm64', label: 'Mac · Apple 芯片', bin: 'bab', note: '适用于 Apple 芯片 Mac；其他架构使用通用源码包。'},
  'windows-x64': {system: 'windows', arch: 'x64', label: 'Windows · x64', bin: 'bab.exe', note: '适用于 64 位 Intel / AMD Windows。'},
  'linux-x64': {system: 'linux', arch: 'x64', label: 'Linux · x64', bin: 'bab', note: '适用于 x64 Linux；其他架构使用通用源码包。'}
};

// Offline assembly only. This script never uploads, changes latest.json remotely, or creates keys.
export async function packageRelease(input) {
  const {version} = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const author = validateConfig(JSON.parse(await fs.readFile(input.authorFile, 'utf8')));
  if (!author.website || !author.feedbackEndpoint || !author.update.sources.length || !author.update.publicKey) throw new Error('公开分发前需配置官网、反馈、签名更新源和公钥。');
  const keyFile = await fs.realpath(input.keyFile);
  if (isWithin(root, keyFile)) throw new Error('签名私钥必须在仓库外。');
  const notes = await fs.readFile(input.notesFile, 'utf8');
  const out = path.resolve(input.outDir);
  const baseURL = new URL(input.downloadBase);
  if (baseURL.protocol !== 'https:' || baseURL.username || baseURL.password || baseURL.search || baseURL.hash || !baseURL.pathname.endsWith('/')) throw new Error('downloadBase 必须是以 / 结尾的 HTTPS 目录地址。');
  const destination = path.join(out, version);
  try {await fs.access(destination); throw new Error('发行版本目录已存在，不能覆盖同版本。请使用新版本或新的输出目录。');} catch (e) {if (e.code !== 'ENOENT') throw e;}
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'bab-release-'));
  const downloads = [];
  try {
    const source = path.join(stage, 'source');
    await fs.mkdir(source);
    await fs.cp(path.join(root, 'skills'), path.join(source, 'skills'), {recursive: true});
    await fs.rm(path.join(source, 'skills/bab/bin'), {recursive: true, force: true});
    await fs.writeFile(path.join(source, 'skills/bab/assets/author.json'), JSON.stringify(author, null, 2) + '\n');
    for (const name of ['LICENSE', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md']) await fs.copyFile(path.join(root, name), path.join(source, name));
    await fs.cp(path.join(root, 'third_party'), path.join(source, 'third_party'), {recursive: true});
    await fs.copyFile(path.join(root, 'scripts/runtime.mjs'), path.join(source, 'runtime.mjs'));
    await fs.mkdir(path.join(source, 'docs'));
    await fs.copyFile(path.join(root, 'docs/quickstart.md'), path.join(source, 'docs/quickstart.md'));
    await fs.writeFile(path.join(source, '开始使用.md'), '# 借个脑子：从这里开始\n\n把这个文件夹交给你正在使用的 AI，说：“帮我安装借个脑子，先给我看具体变化。”\n\n[打开安装与上手说明](docs/quickstart.md)\n\n[三次上手练习](skills/bab/assets/getting-started.md)\n');
    await fs.writeFile(path.join(source, 'README.md'), `# 借个脑子 · ${version}\n\n借别人的思路，理自己的难题。\n\n[开始使用](docs/quickstart.md) · [三次练习](skills/bab/assets/getting-started.md) · [更新记录](CHANGELOG.md)\n\n官方说明：${author.website}\n\n本包包含五个中文 Skill 和完整的本地应用脚本。人物资料不随包分发。\n`);
    const files = [];
    for (const name of Object.keys(await fileMap(path.join(source, 'skills')))) {
      const bytes = await fs.readFile(path.join(source, 'skills', name));
      files.push({path: `skills/${name}`, content: bytes.toString('base64'), sha256: sha(bytes)});
    }
    const payload = Buffer.from(JSON.stringify({schema: 1, version, notes, files}));
    const envelope = {payload: payload.toString('base64'), signature: sign(null, payload, await fs.readFile(keyFile)).toString('base64')};
    verifyBundle(envelope, author.update.publicKey);
    await fs.mkdir(path.join(stage, 'output'));
    const packs = [{name: 'source', dir: source, system: 'source', arch: 'any', label: '通用源码包', note: '需要 Node.js 22+；不需要 GitHub 账号。'}];
    for (const runtime of input.runtimes || []) {
      const spec = variants[runtime.name];
      if (!spec || packs.some(x => x.name === runtime.name)) throw new Error('独立程序平台未知或重复。');
      const runtimeVersion = JSON.parse(await fs.readFile(path.join(runtime.dir, 'skills/bab/assets/version.json'), 'utf8')).version;
      if (runtimeVersion !== version) throw new Error('独立程序目录不是本次构建版本，请取得对应 CI 构建。');
      const executable = path.join(runtime.dir, 'skills/bab/bin', spec.bin);
      const stat = await fs.lstat(executable); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('独立程序必须是普通文件。');
      const dir = path.join(stage, runtime.name); await fs.cp(source, dir, {recursive: true});
      await fs.mkdir(path.join(dir, 'skills/bab/bin'));
      await fs.copyFile(executable, path.join(dir, 'skills/bab/bin', spec.bin));
      await fs.chmod(path.join(dir, 'skills/bab/bin', spec.bin), 0o755);
      packs.push({name: runtime.name, dir, ...spec});
    }
    for (const pack of packs) {
      const filename = `borrow-a-brain-${pack.name}.zip`, zip = path.join(stage, 'output', filename);
      // Python is an author-only archive dependency; the installed core remains Node standard library.
      const result = spawnSync(input.python || (process.platform === 'win32' ? 'python' : 'python3'), ['-c',
        'import pathlib,sys,zipfile\nr=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED,compresslevel=6) as z:\n for p in sorted(r.rglob("*")):\n  if p.is_file(): z.write(p,p.relative_to(r))\n', pack.dir, zip], {encoding: 'utf8'});
      if (result.status !== 0) throw new Error(`ZIP 构建失败：${result.stderr || result.error}`);
      const bytes = await fs.readFile(zip);
      downloads.push({system: pack.system, arch: pack.arch, label: pack.label, note: pack.note,
        url: new URL(`${version}/${filename}`, baseURL).href, bytes: bytes.length, sha256: sha(bytes)});
    }
    await fs.writeFile(path.join(stage, 'output/update.json'), JSON.stringify(envelope));
    await fs.writeFile(path.join(stage, 'output/SHA256SUMS.txt'), downloads.map(d => `${d.sha256}  ${new URL(d.url).pathname.split('/').at(-1)}`).join('\n') + '\n');
    let previous = {versions: []};
    if (input.previousReleasesFile) previous = JSON.parse(await fs.readFile(input.previousReleasesFile, 'utf8'));
    const manifest = {version, versions: [...new Set([version, ...(previous.versions || [])])], date: new Date().toISOString().slice(0, 10), channel: 'preview', notes, downloads};
    await fs.writeFile(path.join(stage, 'output/release.json'), JSON.stringify(manifest, null, 2) + '\n');
    await fs.mkdir(out, {recursive: true});
    await fs.mkdir(destination); // exclusive version reservation; never overwrite an earlier release
    await fs.cp(path.join(stage, 'output'), destination, {recursive: true});
    await fs.writeFile(path.join(out, 'latest.json'), JSON.stringify(envelope));
    await fs.writeFile(path.join(out, 'releases.json'), JSON.stringify(manifest, null, 2) + '\n');
    await fs.writeFile(path.join(out, 'author.json'), JSON.stringify(author, null, 2) + '\n');
    return {version, destination, packages: downloads.length, signatureVerified: true, published: false, downloads};
  } finally {await fs.rm(stage, {recursive: true, force: true});}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('用法：node scripts/package-release.mjs 仓库外的发行配置.json');
  console.log(JSON.stringify(await packageRelease(JSON.parse(await fs.readFile(process.argv[2], 'utf8'))), null, 2));
}
