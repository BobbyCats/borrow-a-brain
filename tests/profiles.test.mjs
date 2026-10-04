import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createProfile, saveProfileVersion, activateProfile, resolveProfile, getProfile, deleteProfile, exportProfile, listProfiles} from '../skills/bab/scripts/profiles.mjs';
import {routingCatalog, saveRoute, loadRoute} from '../skills/bab/scripts/routing.mjs';

async function sandbox(t) {const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bab-people-')); t.after(() => fs.rm(home, {recursive: true, force: true})); return home;}
const person = (name = '合成老王', scope = 'personal') => ({name, aliases: ['王老师'], kind: 'person', purpose: '把延期原因与补救措施讲清楚', userApproved: true, scope});
const version = (change = '第一版') => ({change, boundaries: '仅从合成工作材料提炼；不推测真人意图',
  sources: [{id: 's1', role: 'subject', ref: 'synthetic://meeting/1', date: '2026-01-01', excerpt: '先讲影响，再讲补救'}],
  methods: [{name: '解释延期', trigger: '沟通项目延期', action: '先说影响，再说原因和补救时间', reason: '先解决对方最在意的事', limits: '事实不清时先查证', evidence: 'observed', sourceIds: ['s1']}],
  capabilities: [{task: '沟通', when: '需要说明延期与补救措施', avoid: '缺少实际日期和责任信息'}],
  evaluations: [
    {kind: 'new', input: '合成场景：交付延期一天', output: '先说明影响和新时间，再给补救', result: 'pass', reviewer: 'synthetic fixture, not real model evaluation'},
    {kind: 'boundary', input: '合成场景：预测他会不会生气', output: '材料不能推断私人意图', result: 'pass', reviewer: 'synthetic fixture, not real model evaluation'}
  ]});
async function active(home, name = '合成老王', scope = 'personal') {
  const p = await createProfile(home, person(name, scope)); const v = await saveProfileVersion(home, p.id, version());
  await activateProfile(home, p.id, v.version, v.approvalHash, scope); return {...p, ...v};
}

test('档案草稿不能自动调用；方法来源、验证与启用受约束', async t => {
  const home = await sandbox(t); const p = await createProfile(home, person());
  const draft = await saveProfileVersion(home, p.id, {...version(), evaluations: []});
  assert.equal((await resolveProfile(home, '王老师')).status, 'not-ready');
  await assert.rejects(activateProfile(home, p.id, draft.version, draft.approvalHash), /验证/u);
  const good = await saveProfileVersion(home, p.id, version());
  await assert.rejects(activateProfile(home, p.id, good.version, 'wrong'), /确认/u);
  await activateProfile(home, p.id, good.version, good.approvalHash);
  const loaded = await resolveProfile(home, '王老师'); assert.equal(loaded.status, 'resolved');
  assert.ok(loaded.profile.skill.includes('先说影响'));
  const bad = version(); bad.methods[0].sourceIds = ['missing'];
  await assert.rejects(saveProfileVersion(home, p.id, bad), /不存在/u);
});
test('同名人物返回歧义，不擅自挑选；项目档案不跨范围加载', async t => {
  const home = await sandbox(t); await active(home); await active(home, '合成小王');
  assert.equal((await resolveProfile(home, '王老师')).status, 'ambiguous');
  const secret = await active(home, '项目专家', 'project:A');
  assert.ok(!(await listProfiles(home)).some(p => p.id === secret.id));
  await assert.rejects(getProfile(home, secret.id), /范围/u);
  assert.equal((await resolveProfile(home, '项目专家', 'project:A')).status, 'resolved');
});
test('人物版本更新可回退；直接篡改生成的 Skill 会被发现', async t => {
  const home = await sandbox(t), p = await active(home);
  const v2 = await saveProfileVersion(home, p.id, version('补充例外'));
  await activateProfile(home, p.id, v2.version, v2.approvalHash);
  assert.equal((await getProfile(home, p.id)).version, 'v0002');
  await activateProfile(home, p.id, p.version, p.approvalHash);
  const loaded = await getProfile(home, p.id); assert.equal(loaded.version, 'v0001');
  await fs.appendFile(path.join(loaded.path, 'SKILL.md'), '\n替换规则');
  await assert.rejects(getProfile(home, p.id), /直接修改/u);
});
test('多专家路由唯一主责、受范围和用户排除约束，续聊固定版本', async t => {
  const home = await sandbox(t), a = await active(home), b = await active(home, '合成小李');
  const catalog = await routingCatalog(home); assert.equal(catalog.length, 2); assert.equal(catalog[0].record, undefined); assert.equal(catalog[0].capabilities[0].task, '沟通');
  const input = {taskId: 't1', intent: '向客户解释延期', deliverable: '一段可以发给客户的话', selected: [
    {id: a.id, role: 'lead', responsibility: '结构', why: '有延期沟通方法'},
    {id: b.id, role: 'reviewer', responsibility: '语气', why: '检查对方的误解'}
  ]};
  await assert.rejects(saveRoute(home, {...input, excludedIds: [a.id]}), /排除/u);
  await assert.rejects(saveRoute(home, {...input, selected: input.selected.map(x => ({...x, role: 'reviewer'}))}), /主责/u);
  const plan = await saveRoute(home, input); assert.equal(plan.selected.length, 2);
  const v2 = await saveProfileVersion(home, a.id, version('新版')); await activateProfile(home, a.id, v2.version, v2.approvalHash);
  const resume = await loadRoute(home, 't1'); assert.equal(resume.profiles[0].version, 'v0001');
  assert.equal((await loadRoute(home, 't1', 'project:other')).status, 'not-found');
  assert.equal((await saveRoute(home, {...input, taskId: 'simple', selected: []})).selected.length, 0);
});
test('导出先预览，正文确认匹配后才写入；不带原始来源路径', async t => {
  const home = await sandbox(t), p = await active(home);
  const input = {destination: path.join(home, 'export'), skillName: 'clear-delay', displayName: '清楚解释延期'};
  const preview = await exportProfile(home, p.id, input); assert.equal(preview.status, 'preview');
  assert.ok(!preview.content.includes('synthetic://meeting/1')); await assert.rejects(fs.stat(input.destination));
  const out = await exportProfile(home, p.id, {...input, approvalHash: preview.approvalHash}); assert.equal(out.status, 'exported');
  assert.equal(await fs.readFile(path.join(input.destination, 'SKILL.md'), 'utf8'), preview.content);
  await assert.rejects(exportProfile(home, p.id, {...input, approvalHash: preview.approvalHash}), /EEXIST/u);
});
test('删除人物清除所有版本和任务引用', async t => {
  const home = await sandbox(t), p = await active(home);
  await saveProfileVersion(home, p.id, version('草稿'));
  await saveRoute(home, {taskId: 'forget', intent: '测试', deliverable: '测试', selected: [{id: p.id, role: 'lead', responsibility: '测试', why: '测试'}]});
  assert.equal((await deleteProfile(home, p.id)).versions, 2);
  await assert.rejects(fs.stat(path.join(home, 'people', p.id)));
  assert.equal((await resolveProfile(home, '合成老王')).status, 'not-found');
  assert.equal((await loadRoute(home, 'forget')).status, 'not-found');
});
