import { randomUUID } from 'node:crypto';
import { boundedString, mutateState, readState } from './store.mjs';

const kinds = new Set(['preference', 'decision', 'method', 'observation']);
const statuses = new Set(['candidate', 'confirmed']);

export function validateRule(input) {
  if (!kinds.has(input.kind)) throw new Error('记忆类型无效。');
  const status = input.status || 'candidate';
  if (!statuses.has(status)) throw new Error('新记忆只能是 candidate 或 confirmed。');
  if (!Array.isArray(input.sources) || !input.sources.length || input.sources.length > 20) throw new Error('记忆需要 1–20 项证据来源。');
  const sources = input.sources.map(source => {
    if (!['user', 'assistant', 'tool', 'document'].includes(source.role)) throw new Error('证据需要明确说话人或材料角色。');
    return {ref: boundedString(source.ref, '来源定位', 2000), role: source.role, excerpt: boundedString(source.excerpt, '必要摘录', 2000)};
  });
  if (status === 'confirmed' && (!input.userConfirmed || !sources.some(s => s.role === 'user'))) throw new Error('确认记忆需要用户确认和用户证据；AI 推断先保存为候选。');
  return {
    kind: input.kind, status, statement: boundedString(input.statement, '规则'),
    scope: boundedString(input.scope || 'personal', '适用范围', 500),
    conditions: boundedString(input.conditions, '适用条件', 2000),
    exceptions: String(input.exceptions || '').slice(0, 2000), sources,
    outcome: String(input.outcome || '尚未验证实际结果').slice(0, 2000),
    userConfirmed: Boolean(input.userConfirmed)
  };
}

export async function addRule(home, input) {
  const rule = validateRule(input);
  return mutateState(home, state => {
    const record = {...rule, id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()};
    state.rules.push(record); return record;
  });
}

export async function listRules(home, {scope, includeCandidates = true} = {}) {
  const state = await readState(home);
  return state.rules.filter(r => r.status !== 'superseded' && (includeCandidates || r.status === 'confirmed') && (!scope || r.scope === 'personal' || r.scope === scope));
}

export async function queryRules(home, query, scope = 'personal', limit = 5) {
  boundedString(query, '查询', 1000);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('查询数量应为 1–20。');
  const terms = [...new Set(query.toLowerCase().split(/[\s,，。;；]+/u).filter(Boolean))];
  const rows = await listRules(home, {scope, includeCandidates: false});
  return rows.map(r => ({...r, score: terms.reduce((n, t) => n + (JSON.stringify([r.statement, r.conditions]).toLowerCase().includes(t) ? 1 : 0), 0)}))
    .filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function supersedeRule(home, id, input) {
  const rule = validateRule(input);
  return mutateState(home, state => {
    const previous = state.rules.find(r => r.id === id && r.status !== 'superseded');
    if (!previous) throw new Error('找不到可替代的规则。');
    if (previous.status === 'confirmed' && rule.status !== 'confirmed') throw new Error('候选推断不能替代已确认规则。');
    const next = {...rule, id: randomUUID(), replaces: id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()};
    previous.status = 'superseded'; previous.replacedBy = next.id;
    state.rules.push(next); return next;
  });
}

export async function forgetRule(home, id) {
  return mutateState(home, state => {
    const original = state.rules.find(r => r.id === id);
    if (!original) throw new Error('找不到该记忆。');
    // Purge the whole revision chain so forgotten text cannot return via an older version.
    const ids = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of state.rules) if (ids.has(r.id) || ids.has(r.replaces) || ids.has(r.replacedBy)) {
        for (const x of [r.id, r.replaces, r.replacedBy].filter(Boolean)) if (!ids.has(x)) {ids.add(x); changed = true;}
      }
    }
    const before = state.rules.length;
    state.rules = state.rules.filter(r => !ids.has(r.id));
    return {forgotten: before - state.rules.length, scope: '本套件内的规则及其修订；不删除宿主原始对话'};
  });
}
