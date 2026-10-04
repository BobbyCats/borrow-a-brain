import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {verify, createHash, createPublicKey} from 'node:crypto';
import {mutateState, readState, isWithin} from './store.mjs';
import {install} from './install.mjs';

const MAX = 8 * 1024 * 1024;
export function compareVersions(a, b) {
  const valid = /^\d+\.\d+\.\d+$/u;
  if (!valid.test(a) || !valid.test(b)) throw new Error('版本必须是三个非负整数。');
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
export function verifyBundle(envelope, publicKey) {
  if (!publicKey) throw new Error('尚未配置作者的可信公钥，不能验证更新。');
  if (createPublicKey(publicKey).asymmetricKeyType !== 'ed25519') throw new Error('更新公钥必须是 Ed25519。');
  if (typeof envelope.payload !== 'string' || envelope.payload.length > MAX * 1.4 || typeof envelope.signature !== 'string') throw new Error('更新包格式或大小无效。');
  const bytes = Buffer.from(envelope.payload, 'base64');
  if (!verify(null, bytes, publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('更新签名无效。');
  const payload = JSON.parse(bytes.toString('utf8'));
  compareVersions(payload.version, '0.0.0');
  if (payload.schema !== 1) throw new Error('更新包格式需要新安装器，未自动迁移。');
  if (!Array.isArray(payload.files) || payload.files.length < 1 || payload.files.length > 300) throw new Error('更新文件清单无效。');
  const seen = new Set(); let size = 0;
  for (const row of payload.files) {
    if (typeof row.path !== 'string' || !/^[a-zA-Z0-9_.\-/]+$/u.test(row.path) || row.path.startsWith('/') || row.path.split('/').some(p => !p || p === '..' || p === '.') || seen.has(row.path.toLowerCase())) throw new Error('更新包含重复或越界路径。');
    if (!row.path.startsWith('skills/')) throw new Error('更新只能写入 Skill 代码目录。');
    seen.add(row.path.toLowerCase());
    const content = Buffer.from(row.content, 'base64'); size += content.length;
    if (size > MAX || createHash('sha256').update(content).digest('hex') !== row.sha256) throw new Error('更新文件大小或校验值无效。');
  }
  if (!seen.has('skills/bab/skill.md')) throw new Error('更新包缺少总入口。');
  if (typeof payload.notes !== 'string' || payload.notes.length > 8000) throw new Error('更新包缺少可阅读的变化说明。');
  return payload;
}

async function boundedResponse(res) {
  const reader = res.body.getReader(); const parts = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.length; if (size > MAX * 1.5) throw new Error('下载超出大小限制。'); parts.push(value);
    }
  } finally {await reader.cancel().catch(() => {});}
  return Buffer.concat(parts).toString('utf8');
}

export async function checkUpdate(home, config, currentVersion, {force = false, now = Date.now(), fetcher = fetch} = {}) {
  compareVersions(currentVersion, '0.0.0');
  if (!Array.isArray(config.sources) || !config.sources.length || !config.publicKey) return {status: 'unconfigured', message: '作者尚未配置可验证的更新源；当前版本仍可使用。'};
  if (config.sources.length > 3) throw new Error('更新源最多 3 个。');
  const state = await readState(home);
  if (!force && state.maintenance.lastCheck && now - state.maintenance.lastCheck < 7 * 86400000) return {status: 'not-due'};
  const failures = [];
  for (const source of config.sources) {
    try {
      const url = new URL(source);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('更新源必须是 HTTPS 地址。');
      const response = await fetcher(url, {redirect: 'error', signal: AbortSignal.timeout(5000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const envelope = JSON.parse(await boundedResponse(response));
      const payload = verifyBundle(envelope, config.publicKey);
      const isNew = compareVersions(payload.version, currentVersion) > 0;
      const notify = isNew && state.maintenance.notifiedVersion !== payload.version;
      await mutateState(home, s => {
        s.maintenance.lastCheck = now;
        if (notify) s.maintenance.notifiedVersion = payload.version;
      });
      return {status: isNew ? 'available' : 'current', version: payload.version, currentVersion,
        notify, notes: payload.notes, source: url.href, envelope: isNew ? envelope : undefined};
    } catch (e) {failures.push({source, error: e.message});}
  }
  // A failed check is not an update failure and must not interrupt the user's task.
  await mutateState(home, s => {s.maintenance.lastCheck = now;});
  return {status: 'offline-or-invalid', failures, message: '未取得有效更新，继续使用当前版本；可手动重查。'};
}

export async function applyUpdate(home, {envelope, publicKey, currentVersion, approvedVersion, skillsDir, rulesFile}) {
  const payload = verifyBundle(envelope, publicKey);
  if (payload.version !== approvedVersion) throw new Error('请先展示更新说明并取得对该版本的确认。');
  if (compareVersions(payload.version, currentVersion) <= 0) throw new Error('不自动降级或重装相同版本。');
  const state = await readState(home);
  const previous = state.installations?.find(i => i.skillsDir === path.resolve(skillsDir));
  if (!previous || previous.version !== currentVersion) throw new Error('安装回执与当前版本不符。');
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'bab-update-'));
  try {
    for (const row of payload.files) {
      const dest = path.join(stage, row.path);
      if (!isWithin(stage, dest)) throw new Error('更新路径越界。');
      await fs.mkdir(path.dirname(dest), {recursive: true}); await fs.writeFile(dest, Buffer.from(row.content, 'base64'));
    }
    const receipt = await install(home, {source: path.join(stage, 'skills'), skillsDir, rulesFile, apply: true, version: payload.version});
    return {updated: payload.version, notes: payload.notes, memoriesPreserved: true, receipt};
  } finally {await fs.rm(stage, {recursive: true, force: true});}
}
