import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createProfile, saveProfileVersion, activateProfile, getProfile} from '../skills/bab/scripts/profiles.mjs';
import {saveRoute, loadRoute} from '../skills/bab/scripts/routing.mjs';
import {readState} from '../skills/bab/scripts/store.mjs';

const runner = fileURLToPath(new URL('../skills/bab/scripts/run.mjs', import.meta.url));
async function fixture(t, scope = 'personal') {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bab-route-execution-'));
  t.after(() => fs.rm(home, {recursive: true, force: true}));
  const p = await createProfile(home, {name: '合成预约判断', kind: 'method', purpose: '区分预约条件', scope, userApproved: true});
  const input = {change: '合成测试夹具', boundaries: '仅对已确认的预约规则；临时请求须另行核实',
    sources: [{id: 's1', role: 'document', ref: 'synthetic://booking', date: '未知', excerpt: '不应自动重复输出的原始材料'}],
    methods: [{name: '先核承接条件', trigger: '预约已经超过约定容量', action: '先核查可承接量，再给延期或分批选项', reason: '避免把意愿当成可交付能力', limits: '没有确认容量时不能编数值', evidence: 'observed', sourceIds: ['s1']}],
    evaluations: [{kind: 'new', input: 'PRIVATE_TRIAL_INPUT', output: 'PRIVATE_TRIAL_OUTPUT', result: 'pass', reviewer: 'synthetic fixture'},
      {kind: 'boundary', input: '没有预约任务', output: '不适用', result: 'pass', reviewer: 'synthetic fixture'}]};
  const v = await saveProfileVersion(home, p.id, input); await activateProfile(home, p.id, v.version, v.approvalHash, scope);
  const plan = {taskId: 'booking', scope, intent: '处理预约', deliverable: '给客户的回复',
    selected: [{id: p.id, version: v.version, role: 'lead', responsibility: '核承接条件', why: '已知容量不足'}]};
  return {home, p, v, input, plan};
}

test('路由成功即可取得完整判断内容，免于第二次读档；不泄露试用原文或启用摘要', async t => {
  const {home, p, plan} = await fixture(t); const full = await getProfile(home, p.id);
  const before = await fs.readFile(path.join(full.path, 'record.json'));
  const out = await saveRoute(home, plan), packet = out.profiles[0];
  assert.equal(packet.version, full.version); assert.equal(packet.status, 'active');
  assert.deepEqual(packet.methods, full.record.methods); assert.equal(packet.boundaries, full.record.boundaries);
  assert.deepEqual(packet.sources, full.record.sources.map(({excerpt, ...s}) => s));
  for (const key of ['approvalHash', 'evaluations', 'skill', 'record', 'path']) assert.equal(packet[key], undefined);
  assert.ok(!JSON.stringify(out).includes('PRIVATE_TRIAL')); assert.ok(!JSON.stringify(out).includes(full.approvalHash));
  assert.deepEqual(await fs.readFile(path.join(full.path, 'record.json')), before);
  const stored = (await readState(home)).tasks['route:booking']; assert.equal(stored.profiles, undefined);
  assert.deepEqual((await loadRoute(home, 'booking')).profiles[0].record.methods, packet.methods);
});

test('新回执仍拒绝跨范围、错版本、用户排除及篡改，不在失败时写分工', async t => {
  const {home, p, v, plan} = await fixture(t, 'project:isolated');
  for (const input of [{...plan, scope: 'personal'}, {...plan, selected: [{...plan.selected[0], version: 'v9999'}]},
    {...plan, excludedIds: [p.id]}, {...plan, selected: [{...plan.selected[0], role: 'reviewer'}]}]) {
    await assert.rejects(saveRoute(home, input)); assert.equal((await readState(home)).tasks['route:booking'], undefined);
  }
  await fs.appendFile(path.join(v.path, 'SKILL.md'), '\n篡改');
  await assert.rejects(saveRoute(home, plan), /直接修改/u); assert.equal((await readState(home)).tasks['route:booking'], undefined);
});

test('带执行内容的回执不提升草稿，精确版本变化要求重新选择', async t => {
  const {home, p, plan, input} = await fixture(t);
  const v2 = await saveProfileVersion(home, p.id, {...input, change: '第二个合成版本'});
  assert.equal((await saveRoute(home, plan)).profiles[0].version, 'v0001');
  await activateProfile(home, p.id, v2.version, v2.approvalHash);
  await assert.rejects(saveRoute(home, plan), /版本已变化/u);
  assert.equal((await readState(home)).tasks['route:booking'].selected[0].version, 'v0001');
});

test('CLI的路由回执可直接使用，简短帮助覆盖真实参数', async t => {
  const {home, plan} = await fixture(t); const file = path.join(home, 'plan.json'); await fs.writeFile(file, JSON.stringify(plan));
  const run = args => spawnSync(process.execPath, [runner, ...args], {env: {...process.env, BAB_HOME: home}, encoding: 'utf8'});
  const help = run(['help', 'route-save']); assert.equal(help.status, 0, help.stderr);
  assert.equal(JSON.parse(help.stdout).example.selected[0].role, 'lead');
  const output = run(['route-save', file]); assert.equal(output.status, 0, output.stderr);
  const payload = JSON.parse(output.stdout); assert.equal(payload.profiles[0].methods[0].evidence, 'observed');
  assert.equal(payload.profiles[0].version, payload.selected[0].version);
});
