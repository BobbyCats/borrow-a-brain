import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {intakeProfile, saveProfileVersion, activateProfile, getProfile, deleteProfile, listProfiles} from '../skills/bab/scripts/profiles.mjs';
import {routingCatalog} from '../skills/bab/scripts/routing.mjs';
import {readState} from '../skills/bab/scripts/store.mjs';

async function sandbox(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bab-intake-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  return path.join(dir, 'data');
}
function proposal(requestId = 'synthetic-1') {
  return {requestId, scope: 'project:synthetic', reason: '合成用户纠正了先讲原因的顺序，后续同类任务可复用。',
    profile: {name: '先说交付影响', kind: 'method', aliases: [], purpose: '解释交付变化'},
    version: {change: '合成纠正形成待试用方法', boundaries: '只用于事实明确的交付通知',
      sources: [{id: 's1', role: 'user', ref: 'synthetic://current-turn', date: 'unknown', excerpt: '先告诉客户交付影响，再讲原因。'}],
      methods: [{name: '先说影响', trigger: '解释交付变化', action: '先列影响和新时间，再说明原因', reason: '读者先需要安排后续工作', limits: '不知道交付时间时不能编造', evidence: 'observed', sourceIds: ['s1']}],
      evaluations: []}};
}
const evaluated = version => ({...version, evaluations: [
  {kind: 'new', input: '合成延期通知', output: '合成顺序回执', result: 'pass', reviewer: 'synthetic fixture; not an actual model trial'},
  {kind: 'boundary', input: '合成范围外问题', output: '不应用此方法', result: 'pass', reviewer: 'synthetic fixture; not an actual model trial'}
]});
async function save(home, input = proposal()) {
  const preview = await intakeProfile(home, input);
  const confirmed = {...input, approvalHash: preview.approvalHash, userApproved: true};
  return {input: confirmed, saved: await intakeProfile(home, confirmed)};
}

test('主动提议预览不创建数据目录；确认绑定具体内容和范围', async t => {
  const home = await sandbox(t), input = proposal();
  const preview = await intakeProfile(home, {...input, userApproved: true});
  assert.equal(preview.status, 'preview');
  assert.equal(preview.content.profile.scope, input.scope);
  assert.equal(preview.readiness.readyToActivate, false);
  await assert.rejects(fs.stat(home), {code: 'ENOENT'});
  for (const userApproved of [undefined, false, 'true', 1]) {
    await assert.rejects(intakeProfile(home, {...input, approvalHash: preview.approvalHash, userApproved}), /明确确认/u);
  }
  for (const changed of [
    {...input, scope: 'personal'}, {...input, reason: '改了推荐理由'},
    {...input, version: {...input.version, methods: [{...input.version.methods[0], action: '改了具体方法'}]}}
  ]) await assert.rejects(intakeProfile(home, {...changed, userApproved: true, approvalHash: preview.approvalHash}), /已变化/u);
  for (const scope of [undefined, '', 'project:', 'global', 'personal\n']) {
    await assert.rejects(intakeProfile(home, {...input, scope}));
  }
  const assistantOnly = proposal(); assistantOnly.version.sources[0].role = 'assistant';
  await assert.rejects(intakeProfile(home, assistantOnly), /AI 建议/u);
  await assert.rejects(fs.stat(home), {code: 'ENOENT'});
});

test('确认后只保存草稿，并发重试不产生重复档案或版本', async t => {
  const home = await sandbox(t), input = proposal();
  const preview = await intakeProfile(home, input);
  const confirmed = {...input, approvalHash: preview.approvalHash, userApproved: true};
  const results = await Promise.all([intakeProfile(home, confirmed), intakeProfile(home, confirmed)]);
  assert.deepEqual(results.map(x => x.status).sort(), ['already-saved', 'draft']);
  assert.equal(results[0].id, results[1].id);
  const rows = await listProfiles(home, input.scope); assert.equal(rows.length, 1);
  const state = await readState(home); assert.equal(state.profiles[0].versions.length, 1);
  assert.equal(state.profiles[0].activeVersion, null);
  assert.deepEqual(await routingCatalog(home, input.scope), []);
  const p = await getProfile(home, rows[0].id, {version: 'v0001', scope: input.scope});
  assert.equal(p.status, 'draft');
  await assert.rejects(activateProfile(home, p.id, p.version, p.approvalHash, input.scope), /验证/u);
  const before = await fs.readFile(path.join(home, 'state.json'), 'utf8');
  assert.equal((await intakeProfile(home, confirmed)).status, 'already-saved');
  assert.equal(await fs.readFile(path.join(home, 'state.json'), 'utf8'), before);
  await assert.rejects(intakeProfile(home, {...confirmed, approvalHash: 'wrong'}), /不匹配/u);
  await assert.rejects(intakeProfile(home, {...confirmed, reason: '改写同编号内容'}), /不同内容/u);
});

test('修订绑定原档案、范围与最新基准；新草稿不替换已启用版本', async t => {
  const home = await sandbox(t), initial = proposal(); initial.version = evaluated(initial.version);
  const {saved} = await save(home, initial);
  await activateProfile(home, saved.id, saved.version, saved.approvalHash, initial.scope);
  const revised = {requestId: 'synthetic-revise', scope: initial.scope, reason: '补充事实未知时的做法',
    target: {id: saved.id, version: saved.version, approvalHash: saved.approvalHash},
    version: {...proposal().version, change: '补充未知时间的处理'}};
  const preview = await intakeProfile(home, revised);
  await assert.rejects(intakeProfile(home, {...revised, scope: 'personal'}), /范围/u);
  const saved2 = await intakeProfile(home, {...revised, approvalHash: preview.approvalHash, userApproved: true});
  assert.equal(saved2.id, saved.id); assert.equal(saved2.version, 'v0002');
  assert.equal((await getProfile(home, saved.id, {scope: initial.scope})).version, 'v0001');
  assert.equal((await intakeProfile(home, {...revised, approvalHash: preview.approvalHash, userApproved: true})).status, 'already-saved');
  const next = {...revised, requestId: 'synthetic-revise-next', target: {id: saved.id, version: saved2.version, approvalHash: saved2.approvalHash}};
  const pending = await intakeProfile(home, next);
  await saveProfileVersion(home, saved.id, {...proposal().version, change: '另一个已授权任务的新版本'});
  await assert.rejects(intakeProfile(home, {...next, approvalHash: pending.approvalHash, userApproved: true}), /已有新版本/u);
  assert.equal((await readState(home)).profiles[0].versions.length, 3);
});

test('保存失败不登记空档案；删除方法一并删除提议回执', async t => {
  const home = await sandbox(t), input = proposal();
  const preview = await intakeProfile(home, input);
  await fs.mkdir(home); await fs.writeFile(path.join(home, 'people'), 'synthetic obstruction');
  await assert.rejects(intakeProfile(home, {...input, approvalHash: preview.approvalHash, userApproved: true}));
  assert.equal((await readState(home)).profiles?.length || 0, 0);
  await fs.rm(path.join(home, 'people'));
  const {saved} = await save(home, input);
  await deleteProfile(home, saved.id);
  assert.equal((await intakeProfile(home, input)).status, 'preview');
  assert.ok(!(await fs.readFile(path.join(home, 'state.json'), 'utf8')).includes(input.requestId));
  await assert.rejects(fs.stat(path.join(home, 'people', saved.id)), {code: 'ENOENT'});
});

test('CLI 接通同一预览与保存流程，不能把字符串 true 当确认', async t => {
  const home = await sandbox(t), file = path.join(path.dirname(home), 'proposal.json');
  const runner = fileURLToPath(new URL('../skills/bab/scripts/run.mjs', import.meta.url));
  const run = () => spawnSync(process.execPath, [runner, 'profile-intake', file], {env: {...process.env, BAB_HOME: home}, encoding: 'utf8'});
  const input = proposal(); await fs.writeFile(file, JSON.stringify(input));
  const result = run(); assert.equal(result.status, 0, result.stderr);
  const preview = JSON.parse(result.stdout); assert.equal(preview.status, 'preview');
  await assert.rejects(fs.stat(home), {code: 'ENOENT'});
  await fs.writeFile(file, JSON.stringify({...input, approvalHash: preview.approvalHash, userApproved: 'true'}));
  assert.equal(run().status, 1);
  await fs.writeFile(file, JSON.stringify({...input, approvalHash: preview.approvalHash, userApproved: true}));
  const saved = run(); assert.equal(saved.status, 0, saved.stderr); assert.equal(JSON.parse(saved.stdout).status, 'draft');
});

test('提交后的锁清理故障不删除已登记版本；重试核验实际文件', async t => {
  const home = await sandbox(t), input = proposal();
  const preview = await intakeProfile(home, input);
  const confirmed = {...input, approvalHash: preview.approvalHash, userApproved: true};
  const originalRm = fs.rm;
  async function failLockCleanup(action) {
    let injected = false;
    fs.rm = async (file, options) => {
      if (!injected && file === path.join(home, 'write.lock')) {
        injected = true;
        throw Object.assign(new Error('synthetic EACCES after commit'), {code: 'EACCES'});
      }
      return originalRm(file, options);
    };
    try {await assert.rejects(action(), /已登记，版本文件已保留/u); assert.equal(injected, true);}
    finally {fs.rm = originalRm; await fs.rm(path.join(home, 'write.lock'), {force: true});}
  }
  await failLockCleanup(() => intakeProfile(home, confirmed));
  const retry = await intakeProfile(home, confirmed); assert.equal(retry.status, 'already-saved');
  const actual = await getProfile(home, retry.id, {version: retry.version, scope: input.scope});
  assert.equal(actual.status, 'draft');
  // The shared legacy version writer must preserve the same post-commit guarantee.
  await failLockCleanup(() => saveProfileVersion(home, retry.id, {...input.version, change: '第二版'}));
  assert.equal((await getProfile(home, retry.id, {version: 'v0002', scope: input.scope})).status, 'draft');
  await fs.rm(path.join(actual.path, 'record.json'));
  await assert.rejects(intakeProfile(home, confirmed), {code: 'ENOENT'});
});
