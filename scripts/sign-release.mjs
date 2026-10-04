import fs from 'node:fs/promises';
import path from 'node:path';
import {sign, createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {fileMap} from '../skills/bab/scripts/install.mjs';
import {verifyBundle} from '../skills/bab/scripts/update.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [keyFile, publicKeyFile, notesFile, out] = process.argv.slice(2);
if (!keyFile || !publicKeyFile || !notesFile || !out) throw new Error('用法：node scripts/sign-release.mjs 私钥路径 公钥路径 更新说明文件 输出文件。密钥必须保存在仓库外。');
const keyPath = await fs.realpath(keyFile);
if (!path.relative(root, keyPath).startsWith('..')) throw new Error('私钥必须保存在仓库外。');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const files = [];
for (const name of Object.keys(await fileMap(path.join(root, 'skills')))) {
  if (/\/bin\//u.test(name)) continue;
  const content = await fs.readFile(path.join(root, 'skills', name));
  files.push({path: `skills/${name}`, content: content.toString('base64'), sha256: createHash('sha256').update(content).digest('hex')});
}
const payload = Buffer.from(JSON.stringify({schema: 1, version: pkg.version, notes: await fs.readFile(notesFile, 'utf8'), files}));
const envelope = {payload: payload.toString('base64'), signature: sign(null, payload, await fs.readFile(keyPath)).toString('base64')};
verifyBundle(envelope, await fs.readFile(publicKeyFile, 'utf8'));
await fs.mkdir(path.dirname(path.resolve(out)), {recursive: true}); await fs.writeFile(out, JSON.stringify(envelope));
console.log(JSON.stringify({out: path.resolve(out), version: pkg.version, files: files.length}));
