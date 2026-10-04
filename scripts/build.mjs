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
await fs.copyFile(path.join(root, 'README.md'), path.join(out, 'README.md'));
await fs.cp(path.join(root, 'docs'), path.join(out, 'docs'), {recursive: true});
const smoke = spawnSync(binary, ['help'], {encoding: 'utf8'});
if (smoke.status !== 0 || !JSON.parse(smoke.stdout).commands.includes('install')) throw new Error(`独立程序未通过回读：${smoke.stderr}`);
console.log(JSON.stringify({out, binary, runtimeSmoke: 'passed'}, null, 2));
