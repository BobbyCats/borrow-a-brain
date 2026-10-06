import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', `${process.platform}-${process.arch}`);
await fs.rm(out, {recursive: true, force: true});
await fs.mkdir(out, {recursive: true});
await fs.cp(path.join(root, 'skills'), path.join(out, 'skills'), {recursive: true});
const binary = path.join(out, 'skills', 'bab', 'bin', process.platform === 'win32' ? 'bab.exe' : 'bab');
await fs.mkdir(path.dirname(binary), {recursive: true});
const build = spawnSync('bun', ['build', '--compile', '--minify', path.join(root, 'scripts', 'runtime.mjs'), '--outfile', binary], {encoding: 'utf8'});
if (build.status !== 0) throw new Error(`构建需要开发机安装 Bun。${build.stderr || build.error}`);
await fs.mkdir(path.join(out, 'docs'));
await fs.copyFile(path.join(root, 'docs/quickstart.md'), path.join(out, 'docs/quickstart.md'));
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md']) {
  await fs.copyFile(path.join(root, name), path.join(out, name));
}
await fs.cp(path.join(root, 'third_party'), path.join(out, 'third_party'), {recursive: true});
await fs.copyFile(path.join(root, 'scripts/runtime.mjs'), path.join(out, 'runtime.mjs'));
await fs.writeFile(path.join(out, 'README.md'), '# 借个脑子 · 开发构建\n\n本构建用于开发与兼容性测试，未配置作者的更新与反馈服务。\n\n[使用指南](docs/quickstart.md) · [上手练习](skills/bab/assets/getting-started.md) · [素材指南](skills/bab/assets/materials-guide.md) · [更新记录](CHANGELOG.md)\n\n[MIT 许可证](LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.md)\n');
const smoke = spawnSync(binary, ['help'], {encoding: 'utf8'});
if (smoke.status !== 0 || !JSON.parse(smoke.stdout).commands.includes('install')) throw new Error(`独立程序未通过回读：${smoke.stderr}`);
console.log(JSON.stringify({out, binary, runtimeSmoke: 'passed'}, null, 2));
