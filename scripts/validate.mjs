import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = ['bab', 'bab-pro', 'bab-me', 'bab-ask', 'bab-help'];
const failures = []; let checkedLinks = 0; let checkedScripts = 0;
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const version = JSON.parse(await fs.readFile(path.join(root, 'skills/bab/assets/version.json'), 'utf8'));
if (version.version !== pkg.version) failures.push('安装包版本与 package.json 不一致');
async function walk(dir) {
  const rows = [];
  for (const e of await fs.readdir(dir, {withFileTypes: true})) {
    if (['.git', 'dist', 'node_modules'].includes(e.name)) continue;
    const file = path.join(dir, e.name);
    if (e.isSymbolicLink()) failures.push(`不接受符号链接：${file}`);
    else if (e.isDirectory()) rows.push(...await walk(file)); else rows.push(file);
  }
  return rows;
}
for (const id of expected) {
  const skill = path.join(root, 'skills', id, 'SKILL.md'); const text = (await fs.readFile(skill, 'utf8')).replace(/\r\n/gu, '\n');
  if (!text.startsWith(`---\nname: ${id}\ndescription: "`) || !text.includes('\n---\n')) failures.push(`frontmatter: ${id}`);
  if (text.split('\n').length > 500) failures.push(`入口过长：${id}`);
  const yaml = await fs.readFile(path.join(root, 'skills', id, 'agents', 'openai.yaml'), 'utf8');
  const short = yaml.match(/short_description: "([^"]+)"/u)?.[1];
  if (!short || short.length < 25 || short.length > 64) failures.push(`short_description 长度：${id}`);
  if (!yaml.includes(`$${id} `)) failures.push(`default_prompt 未提及命令：${id}`);
}
for (const file of await walk(root)) {
  if (file.endsWith('.md')) {
    const text = await fs.readFile(file, 'utf8');
    for (const m of text.matchAll(/\]\(([^)]+)\)/gu)) {
      if (/^(https?:|#|mailto:)/u.test(m[1])) continue;
      checkedLinks++;
      try {await fs.access(path.resolve(path.dirname(file), m[1].split('#')[0]));} catch {failures.push(`失效本地链接：${path.relative(root, file)} → ${m[1]}`);}
    }
  }
  if (file.endsWith('.mjs')) {
    checkedScripts++;
    const result = spawnSync(process.execPath, ['--check', file], {encoding: 'utf8'});
    if (result.status !== 0) failures.push(`语法：${file}\n${result.stderr}`);
  }
}
console.log(JSON.stringify({skills: expected.length, checkedLinks, checkedScripts, failures}, null, 2));
if (failures.length) process.exitCode = 1;
