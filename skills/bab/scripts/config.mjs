import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {atomicJSON, boundedString} from './store.mjs';

function https(value) {
  if (value === null) return null;
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('作者地址必须为 HTTPS，且不得内嵌凭据。');
  return u.href;
}
export function validateConfig(input) {
  if (input.schema !== 1) throw new Error('作者配置版本无效。');
  const sources = input.update?.sources || [];
  if (!Array.isArray(sources) || sources.length > 3) throw new Error('最多配置 3 个更新源，避免检查拖延任务。');
  const resources = (input.resources || []).map(r => ({id: boundedString(r.id, '资源编号', 100), title: boundedString(r.title, '资源标题', 200), when: boundedString(r.when, '适用场景', 500), url: https(r.url)}));
  if (resources.some(r => !r.url) || new Set(resources.map(r => r.id)).size !== resources.length) throw new Error('资源需有真实地址和唯一编号。');
  return {schema: 1, website: https(input.website ?? null), feedbackEndpoint: https(input.feedbackEndpoint ?? null), resources,
    update: {sources: sources.map(https), publicKey: input.update?.publicKey || null}};
}
export async function readConfig(home) {
  try {return {source: 'local', config: validateConfig(JSON.parse(await fs.readFile(path.join(home, 'author.json'), 'utf8')))};}
  catch (e) {if (e.code !== 'ENOENT') throw e;}
  const bundled = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'author.json');
  return {source: 'bundled', config: validateConfig(JSON.parse(await fs.readFile(bundled, 'utf8')))};
}
export async function saveConfig(home, input) {
  const config = validateConfig(input); await atomicJSON(path.join(home, 'author.json'), config);
  return {saved: true, config, note: '新反馈地址仍需随正文重新确认。此处配置不授予发送权限。'};
}
