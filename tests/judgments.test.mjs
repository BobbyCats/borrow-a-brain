import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startJudgment, setJudgments, challengeJudgment, loadJudgment, listJudgments, deleteJudgment} from '../skills/bab/scripts/judgments.mjs';
import {clearDerivedData, readState} from '../skills/bab/scripts/store.mjs';
const node = (id, kind, status, deps = []) => ({id, kind, status, claim: id, basis: '合成材料；暂定判断不等于已证明', dependsOn: deps.map(id => ({id, revision: 1}))});
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bab-judgment-')); t.after(() => fs.rm(home, {recursive: true, force: true}));
  await startJudgment(home, {taskId: 'case', scope: 'personal', goal: '降低总报废，不能转移给门店', nodes: [
    node('cause', 'hypothesis', 'working'), node('trial', 'decision', 'working', ['cause']),
    node('budget', 'decision', 'working', ['trial']), node('other', 'decision', 'working'),
    node('diamond', 'decision', 'working', ['cause', 'trial'])]});
  return home;
}
test('反例撤下全部依赖建议；无关决定保留；持久回读只开放先决前沿', async t => {
  const home = await fixture(t);
  const r = await challengeJudgment(home, 'case', {scope: 'personal', expectedRevision: 1, targets: ['cause'], evidence: {summary: '缩短生产批次后总报废未降，只从工厂转移到门店', source: '合成试验台账第 2 轮'}});
  assert.deepEqual(r.recommendations, ['other']); assert.deepEqual(r.frontier.ready, ['cause']);
  assert.deepEqual(r.frontier.blocked, ['trial', 'budget', 'diamond']);
  assert.equal(r.nodes.find(n => n.id === 'diamond').revision, 2);
  assert.deepEqual((await loadJudgment(home, 'case', 'personal')).events, r.events);
  assert.equal((await listJudgments(home, 'personal'))[0].needsReview.length, 4);
  assert.equal((await loadJudgment(home, 'case', 'project:/elsewhere')).status, 'not-found');
});
test('不能跳过失效前提；反例后改变建议与预算，审计保留旧判断', async t => {
  const home = await fixture(t);
  await challengeJudgment(home, 'case', {scope: 'personal', expectedRevision: 1, targets: ['cause'], evidence: {summary: '总报废未降', source: '合成台账'}});
  const snapshot = await fs.readFile(path.join(home, 'state.json'), 'utf8');
  await assert.rejects(setJudgments(home, 'case', {scope: 'personal', expectedRevision: 2, reason: '试图直接恢复预算', nodes: [node('budget', 'decision', 'working', ['trial'])]}), /先复核/u);
  assert.equal(await fs.readFile(path.join(home, 'state.json'), 'utf8'), snapshot);
  await setJudgments(home, 'case', {scope: 'personal', expectedRevision: 2, reason: '原机制被反例推翻', nodes: [node('cause', 'hypothesis', 'rejected')]});
  await assert.rejects(setJudgments(home, 'case', {scope: 'personal', expectedRevision: 3, reason: '旧依赖版本', nodes: [node('trial', 'decision', 'working', ['cause'])]}), /先复核/u);
  const changed = {...node('trial', 'decision', 'working'), claim: '停止扩产；先比较门店周转与总报废', dependsOn: [{id: 'cause', revision: 3}]};
  const r = await setJudgments(home, 'case', {scope: 'personal', expectedRevision: 3, reason: '反例改变行动', nodes: [changed]});
  assert.deepEqual(r.recommendations, ['trial', 'other']); assert.ok(r.frontier.ready.includes('budget'));
  assert.equal(r.events[0].nodes[1].claim, 'trial'); assert.equal(r.nodes[1].claim, changed.claim);
  const last = await setJudgments(home, 'case', {scope: 'personal', expectedRevision: 4, reason: '复核下游投入', nodes: [{...node('budget', 'decision', 'rejected'), claim: '取消原扩产预算', dependsOn: [{id: 'trial', revision: 4}]}]});
  assert.equal(last.nodes.find(n => n.id === 'budget').status, 'rejected');
});
test('原图边被替换也使后续决定失效；并发旧版本不能覆盖', async t => {
  const home = await fixture(t);
  const r = await setJudgments(home, 'case', {scope: 'personal', expectedRevision: 1, reason: '改行动', nodes: [{...node('trial', 'decision', 'working'), claim: '改为小样实验'}]});
  assert.equal(r.nodes.find(n => n.id === 'budget').status, 'needs-review');
  await assert.rejects(challengeJudgment(home, 'case', {scope: 'personal', expectedRevision: 1, targets: ['other'], evidence: {summary: '过时写入', source: '测试'}}), /版本已变化/u);
  const normalized = await setJudgments(home, 'case', {scope: 'personal', expectedRevision: 2, reason: '编号首尾空格不能重置版本', nodes: [node(' trial ', 'decision', 'working')]});
  assert.equal(normalized.nodes.find(n => n.id === 'trial').revision, 3);
  await assert.rejects(setJudgments(home, 'case', {scope: 'personal', expectedRevision: 3, reason: '不能绕过类型检查', nodes: [node(' trial ', 'hypothesis', 'working')]}), /不能更换类型/u);
});
test('拒绝循环、悬空、重复节点和决定伪装成因果证明；失败事务不落盘', async t => {
  const home = await fixture(t);
  for (const nodes of [[node('x', 'hypothesis', 'open', ['x'])], [node('x', 'hypothesis', 'open', ['missing'])], [node('x', 'decision', 'supported')], [node('x', 'hypothesis', 'open'), node('x', 'hypothesis', 'open')]]) {
    await assert.rejects(startJudgment(home, {taskId: 'bad', scope: 'personal', goal: '测试', nodes}));
  }
  assert.equal((await loadJudgment(home, 'bad', 'personal')).status, 'not-found');
  await assert.rejects(startJudgment(home, {taskId: 'case', scope: 'personal', goal: '覆盖', nodes: [node('x', 'hypothesis', 'open')]}), /已存在/u);
  assert.equal((await readState(home)).tasks['judgment:case'].revision, 1);
});
test('同批复核必须引用精确新版本，删除和全清除包含判断数据', async t => {
  const home = await fixture(t);
  const r = await setJudgments(home, 'case', {scope: 'personal', expectedRevision: 1, reason: '同轮新证据', nodes: [node('cause', 'hypothesis', 'supported'), {...node('trial', 'decision', 'working'), dependsOn: [{id: 'cause', revision: 2}]}]});
  assert.equal(r.nodes.find(n => n.id === 'trial').status, 'working');
  assert.equal(r.nodes.find(n => n.id === 'budget').status, 'needs-review');
  assert.deepEqual(await deleteJudgment(home, 'case', 'project:/other'), {deleted: false});
  await clearDerivedData(home); assert.deepEqual(await listJudgments(home, 'personal'), []);
});
