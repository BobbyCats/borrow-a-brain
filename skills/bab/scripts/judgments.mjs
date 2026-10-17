import {boundedString, mutateState, readState} from './store.mjs';

// Models assess evidence. This module owns revisions, dependency freshness and
// invalidation; a 'working' recommendation is never a claim of proven causality.
const settled = new Set(['working', 'supported', 'rejected']);
const statuses = new Set(['open', ...settled, 'needs-review']);
const id = value => boundedString(value, '编号', 100);
function scopeOf(value) {
  if (typeof value !== 'string' || value.length > 500 || /[\r\n\0]/u.test(value) || !/^(personal|project:.+)$/u.test(value)) throw new Error('必须明确提供 personal 或 route-context 返回的 project: 范围。');
  return value;
}
const key = taskId => `judgment:${id(taskId)}`;
function existing(state, taskId, scope, revision) {
  const row = state.tasks[key(taskId)];
  if (!row || row.scope !== scopeOf(scope)) throw new Error('此范围内找不到判断任务。');
  if (!Number.isInteger(revision) || revision !== row.revision) throw new Error('判断版本已变化；请 judgment-load 后重新检查，未覆盖。');
  return row;
}
function nodeFrom(input, previous) {
  const node = {id: id(input.id), kind: input.kind, claim: boundedString(input.claim, '判断内容', 2000),
    status: input.status, basis: boundedString(input.basis, '依据及不确定性', 4000), revision: (previous?.revision || 0) + 1};
  if (!['observation', 'hypothesis', 'decision'].includes(node.kind)) throw new Error('判断类型为 observation、hypothesis 或 decision。');
  if (previous && previous.kind !== node.kind) throw new Error('已有节点不能更换类型；请建立新节点。');
  if (!statuses.has(node.status)) throw new Error('判断状态为 open、working、supported、rejected 或 needs-review。');
  if (node.kind === 'decision' && node.status === 'supported') throw new Error('决定使用 working；选择某行动不等于证据证明原因。');
  if (!Array.isArray(input.dependsOn) || input.dependsOn.length > 100) throw new Error('dependsOn 必须是最多 100 项依赖数组。');
  node.dependsOn = input.dependsOn.map(d => {
    if (!Number.isInteger(d.revision) || d.revision < 1) throw new Error('依赖必须记录已审阅的精确 revision。');
    return {id: id(d.id), revision: d.revision};
  });
  if (new Set(node.dependsOn.map(d => d.id)).size !== node.dependsOn.length) throw new Error('依赖不能重复。');
  return node;
}
function checkGraph(row) {
  const byId = new Map(row.nodes.map(n => [n.id, n]));
  const visiting = new Set(), visited = new Set();
  function visit(node) {
    if (visiting.has(node.id)) throw new Error('判断依赖不能形成循环。');
    if (visited.has(node.id)) return;
    visiting.add(node.id);
    for (const dep of node.dependsOn) {
      const parent = byId.get(dep.id);
      if (!parent) throw new Error(`依赖不存在：${dep.id}`);
      visit(parent);
      if (settled.has(node.status) && (!settled.has(parent.status) || dep.revision !== parent.revision)) throw new Error(`先复核依赖 ${dep.id}，再处理 ${node.id}；不能沿用失效或未决前提。`);
    }
    visiting.delete(node.id); visited.add(node.id);
  }
  row.nodes.forEach(visit);
}
function invalidate(row, roots, exempt = new Set()) {
  const affected = new Set(roots), changed = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const node of row.nodes) if (!affected.has(node.id) && node.dependsOn.some(d => affected.has(d.id))) {
      affected.add(node.id); progress = true;
    }
  }
  for (const node of row.nodes) if (affected.has(node.id) && !exempt.has(node.id)) {
    node.status = 'needs-review'; node.revision++; changed.push(node.id);
  }
  return changed;
}
function view(row) {
  const byId = new Map(row.nodes.map(n => [n.id, n]));
  const pending = row.nodes.filter(n => !settled.has(n.status));
  const ready = pending.filter(n => n.dependsOn.every(d => settled.has(byId.get(d.id).status))).map(n => n.id);
  return {...structuredClone(row), frontier: {ready, blocked: pending.filter(n => !ready.includes(n.id)).map(n => n.id)},
    recommendations: row.nodes.filter(n => n.kind === 'decision' && n.status === 'working').map(n => n.id),
    semantics: 'working 是暂定判断或建议；supported 是宿主依据材料作出的证据判断。程序只保证依赖与版本一致，不认证事实、不授权执行。'};
}
function record(row, event) {
  row.revision++; row.updatedAt = new Date().toISOString();
  row.events.push({...event, revision: row.revision, at: row.updatedAt});
  return view(row);
}
export async function startJudgment(home, input) {
  const taskId = id(input.taskId), scope = scopeOf(input.scope);
  if (!Array.isArray(input.nodes) || !input.nodes.length || input.nodes.length > 100) throw new Error('初始判断需要 1–100 个节点。');
  const row = {taskId, scope, goal: boundedString(input.goal, '本次目标', 2000), revision: 0,
    nodes: input.nodes.map(n => nodeFrom(n)), events: []};
  if (new Set(row.nodes.map(n => n.id)).size !== row.nodes.length) throw new Error('判断编号不能重复。');
  checkGraph(row);
  return mutateState(home, s => {
    if (s.tasks[key(taskId)]) throw new Error('判断任务已存在；使用 judgment-set 更新，不得覆盖历史。');
    s.tasks[key(taskId)] = row;
    return record(row, {type: 'start', goal: row.goal, nodes: structuredClone(row.nodes)});
  });
}
export async function setJudgments(home, taskId, input) {
  if (!Array.isArray(input.nodes) || !input.nodes.length || input.nodes.length > 100) throw new Error('每次更新 1–100 个节点。');
  const reason = boundedString(input.reason, '变更理由', 4000);
  return mutateState(home, s => {
    const row = existing(s, taskId, input.scope, input.expectedRevision);
    const updates = input.nodes.map(n => nodeFrom(n, row.nodes.find(old => old.id === id(n.id))));
    const ids = new Set(updates.map(n => n.id));
    if (ids.size !== updates.length) throw new Error('判断编号不能重复。');
    // Walk the old graph before replacing edges: dropping a premise still
    // invalidates descendants. Explicitly re-reviewed nodes must pass below.
    const invalidated = invalidate(row, ids, ids);
    row.nodes = row.nodes.map(n => updates.find(u => u.id === n.id) || n);
    row.nodes.push(...updates.filter(n => !row.nodes.some(old => old.id === n.id)));
    if (row.nodes.length > 100) throw new Error('每个判断任务最多 100 个节点。');
    checkGraph(row);
    return record(row, {type: 'revise', reason, changed: [...ids], invalidated,
      nodes: structuredClone(updates)});
  });
}
export async function challengeJudgment(home, taskId, input) {
  const evidence = {summary: boundedString(input.evidence?.summary, '反例内容', 4000),
    source: boundedString(input.evidence?.source, '反例来源', 2000)};
  if (!Array.isArray(input.targets) || !input.targets.length || input.targets.length > 100) throw new Error('需要指定反例触及的节点。');
  const targets = [...new Set(input.targets.map(id))];
  return mutateState(home, s => {
    const row = existing(s, taskId, input.scope, input.expectedRevision);
    if (targets.some(target => !row.nodes.some(n => n.id === target))) throw new Error('反例目标不存在。');
    const invalidated = invalidate(row, targets);
    checkGraph(row);
    return record(row, {type: 'challenge', evidence, targets, invalidated});
  });
}
export async function loadJudgment(home, taskId, scope) {
  const row = (await readState(home)).tasks[key(taskId)];
  if (!row || row.scope !== scopeOf(scope)) return {status: 'not-found'};
  checkGraph(row);
  return view(row);
}
export async function listJudgments(home, scope) {
  scopeOf(scope);
  return Object.entries((await readState(home)).tasks).filter(([k, row]) => k.startsWith('judgment:') && row.scope === scope)
    .map(([, row]) => ({taskId: row.taskId, goal: row.goal, revision: row.revision, updatedAt: row.updatedAt,
      needsReview: row.nodes.filter(n => n.status === 'needs-review').map(n => n.id)}))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function deleteJudgment(home, taskId, scope) {
  scopeOf(scope);
  return mutateState(home, s => {
    const row = s.tasks[key(taskId)];
    if (!row || row.scope !== scope) return {deleted: false};
    delete s.tasks[key(taskId)]; return {deleted: true};
  });
}
