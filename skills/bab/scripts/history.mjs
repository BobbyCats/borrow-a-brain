import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {boundedString, isWithin, mutateState, readState} from './store.mjs';

const adapters = new Set(['codex', 'claude', 'export']);
const MAX_BYTES = 2 * 1024 * 1024;

export async function grantHistory(home, input) {
  if (!input.userApproved) throw new Error('先取得用户对平台、目录和用途的授权。');
  if (!adapters.has(input.adapter)) throw new Error('支持 codex / claude / export。');
  const root = await fs.realpath(boundedString(input.root, '记录目录', 2000));
  if (!(await fs.stat(root)).isDirectory()) throw new Error('授权范围必须是目录。');
  const days = input.days ?? 1;
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('授权有效期应为 1–30 天。');
  const grant = {id: randomUUID(), root, adapter: input.adapter,
    purpose: boundedString(input.purpose, '读取用途', 500),
    project: input.project ? boundedString(input.project, '项目范围', 2000) : null,
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + days * 86400000).toISOString()};
  await mutateState(home, s => s.grants.push(grant));
  return grant;
}

export async function revokeHistory(home, id) {
  return mutateState(home, s => {
    const row = s.grants.find(g => g.id === id);
    if (!row) throw new Error('找不到授权。');
    row.revokedAt = new Date().toISOString(); return {revoked: id};
  });
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(c => ['text', 'input_text', 'output_text'].includes(c.type)).map(c => c.text || '').join('\n');
}

export function parseSession(raw, adapter, ref) {
  const messages = []; let meta = {}; let malformed = 0;
  let rows;
  if (adapter === 'export') {
    const obj = JSON.parse(raw);
    rows = Array.isArray(obj) ? obj : obj.messages;
    if (!Array.isArray(rows)) throw new Error('导出格式应是消息数组或含 messages 的对象。');
    meta = Array.isArray(obj) ? {} : obj;
  } else rows = raw.split('\n').filter(Boolean).flatMap(line => {
    try {return [JSON.parse(line)];} catch {malformed++; return [];}
  });
  rows.forEach((row, index) => {
    if (row.type === 'session_meta') {meta = {...meta, ...row.payload}; return;}
    if (adapter === 'claude') {
      meta = {...meta, id: row.sessionId || meta.id, cwd: row.cwd || meta.cwd,
        child: meta.child || row.isSidechain || false};
    }
    // Codex event_msg mirrors response_item; don't double-count it as evidence.
    const msg = adapter === 'codex' ? (row.type === 'response_item' ? row.payload : null)
      : adapter === 'claude' ? row.message : row;
    if (!msg || !['user', 'assistant'].includes(msg.role)) return;
    const text = contentText(msg.content);
    if (!text.trim()) return;
    messages.push({role: msg.role, text, timestamp: row.timestamp || msg.timestamp || null,
      ref: `${ref}#message-${index + 1}`, id: msg.id || row.uuid || null});
  });
  return {id: meta.id || meta.sessionId || path.basename(ref), project: meta.cwd || meta.project || null,
    child: Boolean(meta.child || meta.forked_from_id || meta.parent_thread_id || meta.source?.subagent),
    messages, malformed};
}

async function candidates(root, maxFiles = 3000) {
  const files = []; let visited = 0; let capped = false;
  async function walk(dir, depth) {
    if (depth > 8 || capped) return;
    const entries = await fs.readdir(dir, {withFileTypes: true});
    for (const entry of entries) {
      if (++visited > maxFiles) {capped = true; break;}
      if (entry.isSymbolicLink()) continue;
      if (/^(archived_sessions|subagents|\.git|node_modules)$/u.test(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file, depth + 1);
      else if (entry.isFile() && /\.jsonl?$/u.test(entry.name)) files.push(file);
    }
  }
  await walk(root, 0);
  const stats = await Promise.all(files.map(async file => ({file, stat: await fs.stat(file)})));
  return {files: stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs), capped};
}

export async function readHistory(home, grantId, {limit = 10} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('每次读取 1–20 个会话。');
  const state = await readState(home);
  const grant = state.grants.find(g => g.id === grantId);
  if (!grant || grant.revokedAt || Date.parse(grant.expiresAt) <= Date.now()) throw new Error('历史记录授权不存在、已撤销或已过期。');
  if (await fs.realpath(grant.root) !== grant.root) throw new Error('记录根目录已改变，请重新授权。');
  const inventory = await candidates(grant.root);
  const sessions = []; const skipped = []; const ids = new Set();
  for (const item of inventory.files) {
    if (sessions.length >= limit) break;
    const real = await fs.realpath(item.file);
    if (!isWithin(grant.root, real)) throw new Error('记录路径越过授权目录。');
    if (item.stat.size > MAX_BYTES) {skipped.push({file: item.file, reason: '超过 2 MiB，请提供指定范围的导出'}); continue;}
    try {
      const session = parseSession(await fs.readFile(real, 'utf8'), grant.adapter, item.file);
      if (session.child || !session.messages.length || ids.has(session.id)) continue;
      if (grant.project && session.project !== grant.project) continue;
      ids.add(session.id); sessions.push(session);
    } catch (e) {skipped.push({file: item.file, reason: e.message});}
  }
  // Raw chat is returned only to the authorized host; it is never added to state.json.
  return {adapter: grant.adapter, requested: limit, returned: sessions.length,
    completeness: inventory.capped || skipped.length || sessions.some(s => s.malformed) ? 'partial' : 'within-selected-directory',
    inventoryCapped: inventory.capped, skipped, sessions};
}
