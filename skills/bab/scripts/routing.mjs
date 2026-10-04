import {randomUUID} from 'node:crypto';
import {boundedString, mutateState, readState} from './store.mjs';
import {getProfile, listProfiles} from './profiles.mjs';

// The host model makes the semantic choice. This module enforces scope, versions and ownership.
export async function routingCatalog(home, scope = 'personal') {
  return (await listProfiles(home, scope)).filter(p => p.activeVersion).map(({versions, aliases, ...p}) => p);
}

export async function saveRoute(home, input) {
  const scope = input.scope || 'personal';
  const taskId = input.taskId || randomUUID(); boundedString(taskId, '任务编号', 100);
  const selected = input.selected || [];
  if (!Array.isArray(selected) || selected.length > 3) throw new Error('默认每次至多 3 份方法，更多视角应拆成明确的下一阶段。');
  if (selected.length && selected.filter(p => p.role === 'lead').length !== 1) throw new Error('多人协作必须恰好有一个主责方法。');
  if (new Set(selected.map(p => p.id)).size !== selected.length) throw new Error('同一档案不能重复入选。');
  const result = [];
  for (const choice of selected) {
    if ((input.excludedIds || []).includes(choice.id)) throw new Error('不能选择用户本次排除的方法。');
    if (!['lead', 'contributor', 'reviewer'].includes(choice.role)) throw new Error('协作角色无效。');
    const p = await getProfile(home, choice.id, {scope});
    if (p.status !== 'active') throw new Error('自动路由只能选择已启用的版本。');
    if (choice.version && choice.version !== p.version) throw new Error('选中版本已变化，请重新读取能力索引。');
    result.push({id: p.id, name: p.name, version: p.version, role: choice.role,
      responsibility: boundedString(choice.responsibility, '本次分工', 1000), why: boundedString(choice.why, '选用理由', 1000)});
  }
  const plan = {taskId, scope, intent: boundedString(input.intent, '当前目标', 1000),
    deliverable: boundedString(input.deliverable, '本轮交付', 1000), selected: result, updatedAt: new Date().toISOString()};
  return mutateState(home, s => {s.tasks[`route:${taskId}`] = plan; return {...plan, selectionBy: 'host-model', execution: 'one-owner-sequential', note: '这是方法分工，不是后台代理已启动的证明。'};});
}

export async function loadRoute(home, taskId, scope = 'personal') {
  const s = await readState(home); const plan = s.tasks[`route:${taskId}`];
  if (!plan || plan.scope !== scope) return {status: 'not-found'};
  const profiles = [];
  for (const row of plan.selected) {
    const p = await getProfile(home, row.id, {version: row.version, scope});
    if (!['active', 'historical'].includes(p.status)) throw new Error('原方法版本不可用，请重新选用。');
    profiles.push(p);
  }
  return {status: 'ready', plan, profiles};
}
