import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync, sign, createHash} from 'node:crypto';
import {readState, mutateState, atomicJSON} from '../skills/bab/scripts/store.mjs';
import {addRule, queryRules, supersedeRule, forgetRule} from '../skills/bab/scripts/memory.mjs';
import {grantHistory, readHistory, revokeHistory, parseSession} from '../skills/bab/scripts/history.mjs';
import {install, uninstall} from '../skills/bab/scripts/install.mjs';
import {draftFeedback, sendFeedback, recordCorrection, resourceGate} from '../skills/bab/scripts/feedback.mjs';
import {checkUpdate, applyUpdate, verifyBundle} from '../skills/bab/scripts/update.mjs';

async function sandbox(t) {const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bab-test-')); t.after(() => fs.rm(dir, {recursive: true, force: true})); return dir;}
const rule = overrides => ({kind: 'preference', statement: '写作先给结论', conditions: '工作报告', sources: [{role: 'user', ref: 'synthetic://1#2', excerpt: '请先给结论'}], ...overrides});
const codex = (id, cwd = '/synthetic', extra = {}) => [
  {type: 'session_meta', payload: {id, cwd, ...extra}},
  {type: 'response_item', payload: {type: 'message', role: 'user', content: [{type: 'input_text', text: '请先给结论'}]}},
  {type: 'event_msg', payload: {type: 'user_message', message: '请先给结论'}},
  {type: 'response_item', payload: {type: 'message', role: 'assistant', content: [{type: 'output_text', text: '我建议先做十件事'}]}}
].map(x => JSON.stringify(x)).join('\n');
const report = {version: '0.1.0', skill: 'bab-ask', goal: '做一个报告', expected: '先给结论', actual: '问太多', steps: '说请写报告', observed: '发生三次', hypothesis: '待验证：路由过度提问', suggestion: '尊重直接执行', excerpt: '联系 test@example.com 13800138000 /Users/example/private sk-testsecret', endpoint: 'https://feedback.example.test/v1/feedback'};

test('并发写入不丢失；损坏状态不静默重置', async t => {
  const home = await sandbox(t);
  await Promise.all(Array.from({length: 12}, () => mutateState(home, s => {s.tasks.count = (s.tasks.count || 0) + 1;})));
  assert.equal((await readState(home)).tasks.count, 12);
  await fs.writeFile(path.join(home, 'state.json'), '{broken');
  await assert.rejects(readState(home));
});
test('变更回调失败不保存半成品', async t => {
  const home = await sandbox(t);
  await assert.rejects(mutateState(home, s => {s.rules.push({bad: true}); throw new Error('abort');}));
  assert.deepEqual((await readState(home)).rules, []);
  await mutateState(home, s => {s.tasks.ok = true;});
  assert.equal((await readState(home)).tasks.ok, true);
});
test('AI 推断不能冒充用户确认', async t => {
  const home = await sandbox(t);
  await assert.rejects(addRule(home, rule({status: 'confirmed'})), /确认/u);
  await assert.rejects(addRule(home, rule({status: 'confirmed', userConfirmed: true, sources: [{role: 'assistant', ref: 'x', excerpt: 'AI 建议'}]})), /用户证据/u);
  const candidate = await addRule(home, rule({}));
  assert.equal(candidate.status, 'candidate');
  assert.equal((await queryRules(home, '结论')).length, 0);
});
test('项目记忆检索不泄漏到其他项目；只返回已确认规则', async t => {
  const home = await sandbox(t);
  await addRule(home, rule({status: 'confirmed', userConfirmed: true, scope: 'project:A'}));
  assert.equal((await queryRules(home, '结论')).length, 0);
  assert.equal((await queryRules(home, '结论', 'project:B')).length, 0);
  assert.equal((await queryRules(home, '结论', 'project:A')).length, 1);
});
test('新规则替代旧规则，忘记会清除整个修订链', async t => {
  const home = await sandbox(t);
  const first = await addRule(home, rule({status: 'confirmed', userConfirmed: true}));
  await assert.rejects(supersedeRule(home, first.id, rule({})), /候选/u);
  const second = await supersedeRule(home, first.id, rule({status: 'confirmed', userConfirmed: true, statement: '聊天可以晚给结论'}));
  assert.equal((await queryRules(home, '结论')).length, 1);
  assert.equal((await forgetRule(home, second.id)).forgotten, 2);
  assert.deepEqual((await readState(home)).rules, []);
});
test('Codex 去重事件但保留说话人；Claude 与导出格式适配', () => {
  const session = parseSession(codex('a'), 'codex', 'fixture');
  assert.equal(session.messages.length, 2);
  assert.deepEqual(session.messages.map(m => m.role), ['user', 'assistant']);
  const claude = parseSession(JSON.stringify({sessionId: 'b', cwd: '/test', type: 'user', message: {role: 'user', content: '你好'}}), 'claude', 'fixture');
  assert.equal(claude.messages[0].text, '你好');
  const exported = parseSession(JSON.stringify({project: 'a', messages: [{role: 'user', content: '导出文字'}]}), 'export', 'fixture');
  assert.equal(exported.project, 'a');
});
test('读取历史须授权，排除子代理，撤销后立即失效', async t => {
  const home = await sandbox(t); const root = path.join(home, 'history'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'one.jsonl'), codex('one'));
  await fs.writeFile(path.join(root, 'child.jsonl'), codex('child', '/synthetic', {source: {subagent: {thread_spawn: {parent_thread_id: 'one'}}}}));
  await assert.rejects(grantHistory(home, {root, adapter: 'codex', purpose: '找习惯'}), /授权/u);
  const grant = await grantHistory(home, {root, adapter: 'codex', purpose: '找习惯', userApproved: true});
  const result = await readHistory(home, grant.id);
  assert.equal(result.returned, 1); assert.equal(result.sessions[0].id, 'one');
  assert.equal((await readState(home)).rules.length, 0);
  assert.ok(!(await fs.readFile(path.join(home, 'state.json'), 'utf8')).includes('请先给结论'));
  await revokeHistory(home, grant.id); await assert.rejects(readHistory(home, grant.id), /撤销/u);
});
test('范围、过期授权和超过 20 个会话受到约束', async t => {
  const home = await sandbox(t); const root = path.join(home, 'history'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'one.jsonl'), codex('a', 'project:A'));
  const grant = await grantHistory(home, {root, adapter: 'codex', purpose: '检查', userApproved: true, project: 'project:B'});
  assert.equal((await readHistory(home, grant.id)).returned, 0);
  await assert.rejects(readHistory(home, grant.id, {limit: 21}));
  await mutateState(home, s => {s.grants[0].expiresAt = '2000-01-01T00:00:00.000Z';});
  await assert.rejects(readHistory(home, grant.id), /过期/u);
});
test('损坏行和大文件明确披露；不把半份材料说成完整记录', async t => {
  const home = await sandbox(t); const root = path.join(home, 'history'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'broken.jsonl'), codex('a') + '\n{bad');
  await fs.writeFile(path.join(root, 'big.jsonl'), 'x'.repeat(2 * 1024 * 1024 + 1));
  const grant = await grantHistory(home, {root, adapter: 'codex', purpose: '检查', userApproved: true});
  const result = await readHistory(home, grant.id);
  assert.equal(result.completeness, 'partial'); assert.equal(result.sessions[0].malformed, 1); assert.equal(result.skipped.length, 1);
});
test('历史适配器不跟随目录内的符号链接', async t => {
  if (process.platform === 'win32') return t.skip('Windows 无管理员权限的符号链接另行验证');
  const home = await sandbox(t); const root = path.join(home, 'history'); await fs.mkdir(root);
  const outside = path.join(home, 'outside.jsonl'); await fs.writeFile(outside, codex('outside'));
  await fs.symlink(outside, path.join(root, 'leak.jsonl'));
  const grant = await grantHistory(home, {root, adapter: 'codex', purpose: '检查', userApproved: true});
  assert.equal((await readHistory(home, grant.id)).returned, 0);
});

async function packageFixture(home) {
  const source = path.join(home, 'package', 'skills'); await fs.mkdir(path.join(source, 'bab'), {recursive: true});
  await fs.writeFile(path.join(source, 'bab', 'SKILL.md'), '---\nname: bab\ndescription: test\n---\n# Test');
  return {source, skillsDir: path.join(home, 'host', 'skills'), rulesFile: path.join(home, 'host', 'AGENTS.md'), version: '0.1.0'};
}
test('安装可预览、幂等，保留原规则；卸载保留记忆', async t => {
  const home = await sandbox(t), config = await packageFixture(home);
  await fs.mkdir(path.dirname(config.rulesFile), {recursive: true}); await fs.writeFile(config.rulesFile, '# My rules\nDo not change me.\n');
  assert.equal((await install(home, config)).apply, false);
  await assert.rejects(fs.stat(config.skillsDir));
  await addRule(home, rule({}));
  await install(home, {...config, apply: true}); await install(home, {...config, apply: true});
  const body = await fs.readFile(config.rulesFile, 'utf8');
  assert.equal(body.match(/borrow-a-brain:start/gu).length, 1); assert.ok(body.startsWith('# My rules\nDo not change me.'));
  await uninstall(home, config.skillsDir);
  assert.equal((await readState(home)).rules.length, 1);
  assert.ok(!(await fs.readFile(config.rulesFile, 'utf8')).includes('borrow-a-brain:start'));
});
test('用户改过的 Skill 或规则块不会被覆盖', async t => {
  const home = await sandbox(t), config = await packageFixture(home);
  await install(home, {...config, apply: true});
  await fs.appendFile(path.join(config.skillsDir, 'bab', 'SKILL.md'), '\nUSER EDIT');
  await assert.rejects(install(home, {...config, apply: true}), /有修改/u);
  await assert.rejects(uninstall(home, config.skillsDir), /修改/u);
});
test('安装后半程失败会恢复已有 Skill', async t => {
  if (process.platform === 'win32') return t.skip('Windows 无管理员权限的符号链接另行验证');
  const home = await sandbox(t), config = await packageFixture(home);
  await install(home, {...config, apply: true});
  const original = await fs.readFile(path.join(config.skillsDir, 'bab', 'SKILL.md'), 'utf8');
  const rulesTarget = path.join(home, 'saved-rules.md'); await fs.rename(config.rulesFile, rulesTarget);
  await fs.symlink(rulesTarget, config.rulesFile);
  await fs.appendFile(path.join(config.source, 'bab', 'SKILL.md'), '\nnew version');
  await assert.rejects(install(home, {...config, apply: true}));
  assert.equal(await fs.readFile(path.join(config.skillsDir, 'bab', 'SKILL.md'), 'utf8'), original);
  assert.equal((await readState(home)).installations.length, 1);
});

test('源代码更新保留已登记的独立运行程序', async t => {
  const home = await sandbox(t), config = await packageFixture(home);
  await fs.mkdir(path.join(config.source, 'bab', 'bin'));
  await fs.writeFile(path.join(config.source, 'bab', 'bin', 'bab'), 'synthetic runtime');
  await install(home, {...config, apply: true});
  await fs.rm(path.join(config.source, 'bab', 'bin'), {recursive: true});
  await fs.appendFile(path.join(config.source, 'bab', 'SKILL.md'), '\nupdated');
  await install(home, {...config, apply: true, version: '0.2.0'});
  assert.equal(await fs.readFile(path.join(config.skillsDir, 'bab', 'bin', 'bab'), 'utf8'), 'synthetic runtime');
  await uninstall(home, config.skillsDir);
});
test('同名外来 Skill 不接管', async t => {
  const home = await sandbox(t), config = await packageFixture(home);
  await fs.mkdir(path.join(config.skillsDir, 'bab'), {recursive: true});
  await fs.writeFile(path.join(config.skillsDir, 'bab', 'SKILL.md'), 'not ours');
  await assert.rejects(install(home, {...config, apply: true}), /同名/u);
  assert.equal(await fs.readFile(path.join(config.skillsDir, 'bab', 'SKILL.md'), 'utf8'), 'not ours');
});
test('反馈先本地草稿；改变收件地址或正文后旧确认失效', async t => {
  const home = await sandbox(t); const draft = await draftFeedback(home, report);
  assert.equal(draft.status, 'draft'); assert.ok(!draft.report.excerpt.includes('test@example.com'));
  assert.ok(!draft.report.excerpt.includes('13800138000')); assert.ok(!draft.report.excerpt.includes('sk-testsecret'));
  let sent = 0; const fetcher = async () => {sent++; return new Response(JSON.stringify({id: draft.report.id, token: 'private'}));};
  await assert.rejects(sendFeedback(home, draft.report.id, 'wrong', {fetcher})); assert.equal(sent, 0);
  await mutateState(home, s => {s.feedback[0].endpoint = 'https://other.example.test';});
  await assert.rejects(sendFeedback(home, draft.report.id, draft.approvalHash, {fetcher})); assert.equal(sent, 0);
});
test('反馈成功后保存回执，重复调用不重发', async t => {
  const home = await sandbox(t); const draft = await draftFeedback(home, report); let calls = 0;
  const fetcher = async () => {calls++; return new Response(JSON.stringify({id: draft.report.id, token: 'private'}));};
  assert.equal((await sendFeedback(home, draft.report.id, draft.approvalHash, {fetcher})).sent, true);
  assert.equal((await sendFeedback(home, draft.report.id, draft.approvalHash, {fetcher})).alreadySent, true); assert.equal(calls, 1);
});
test('三次同任务同问题的明确纠正才建议反馈，且只建议一次', async t => {
  const home = await sandbox(t), input = {explicit: true, problemKey: '提问太多'};
  assert.equal((await recordCorrection(home, 'task1', {explicit: false})).suggestFeedback, false);
  assert.equal((await recordCorrection(home, 'task1', input)).suggestFeedback, false);
  assert.equal((await recordCorrection(home, 'task2', input)).suggestFeedback, false);
  assert.equal((await recordCorrection(home, 'task1', input)).suggestFeedback, false);
  assert.equal((await recordCorrection(home, 'task1', input)).suggestFeedback, true);
  assert.equal((await recordCorrection(home, 'task1', input)).suggestFeedback, false);
});
test('作者资源需相关证据，14 天冷却，同资源不重复，可永久关闭', async t => {
  const home = await sandbox(t), now = Date.now(), args = {id: 'guide', relevant: true, evidence: '用户询问安装'};
  assert.equal((await resourceGate(home, {...args, relevant: false}, now)).show, false);
  assert.equal((await resourceGate(home, args, now)).show, true);
  assert.equal((await resourceGate(home, {...args, id: 'other'}, now)).show, false);
  assert.equal((await resourceGate(home, args, now + 15 * 86400000)).show, false);
  await resourceGate(home, {disable: true}, now);
  assert.equal((await resourceGate(home, {...args, id: 'other'}, now + 15 * 86400000)).show, false);
});

function bundle(version = '0.2.0', filePath = 'skills/bab/SKILL.md', keys = generateKeyPairSync('ed25519')) {
  const content = Buffer.from('---\nname: bab\ndescription: new\n---\n# New');
  const payload = Buffer.from(JSON.stringify({schema: 1, version, notes: '减少重复追问。记忆保留。', files: [{path: filePath, content: content.toString('base64'), sha256: createHash('sha256').update(content).digest('hex')}]}));
  return {envelope: {payload: payload.toString('base64'), signature: sign(null, payload, keys.privateKey).toString('base64')}, publicKey: keys.publicKey.export({type: 'spki', format: 'pem'})};
}
test('更新验证签名、路径，拒绝伪造包', () => {
  const good = bundle(); assert.equal(verifyBundle(good.envelope, good.publicKey).version, '0.2.0');
  assert.throws(() => verifyBundle({...good.envelope, signature: Buffer.from('bad').toString('base64')}, good.publicKey));
  const traversal = bundle('0.2.0', 'skills/../../state.json'); assert.throws(() => verifyBundle(traversal.envelope, traversal.publicKey), /越界/u);
});
test('更新失败回退镜像；同版本只提醒一次；无网络不阻断', async t => {
  const home = await sandbox(t), good = bundle(); let calls = 0;
  const config = {sources: ['https://primary.example.test', 'https://mirror.example.test'], publicKey: good.publicKey};
  const fetcher = async url => {calls++; if (String(url).includes('primary')) throw new Error('offline'); return new Response(JSON.stringify(good.envelope));};
  const first = await checkUpdate(home, config, '0.1.0', {fetcher}); assert.equal(first.status, 'available'); assert.equal(first.notify, true); assert.equal(calls, 2);
  assert.equal((await checkUpdate(home, config, '0.1.0', {fetcher})).status, 'not-due');
  assert.equal((await checkUpdate(home, config, '0.1.0', {fetcher, force: true})).notify, false);
  assert.equal((await checkUpdate(home, config, '0.1.0', {fetcher: async () => {throw new Error('offline');}, force: true})).status, 'offline-or-invalid');
});
test('确认版本后更新安装代码，保留记忆，拒绝重复安装和降级', async t => {
  const home = await sandbox(t), config = await packageFixture(home), good = bundle();
  await install(home, {...config, apply: true}); const memory = await addRule(home, rule({}));
  const input = {...good, currentVersion: '0.1.0', approvedVersion: '0.2.0', skillsDir: config.skillsDir, rulesFile: config.rulesFile};
  await assert.rejects(applyUpdate(home, {...input, approvedVersion: '0.3.0'}), /确认/u);
  assert.equal((await applyUpdate(home, input)).updated, '0.2.0');
  assert.equal((await readState(home)).rules[0].id, memory.id);
  assert.ok((await fs.readFile(path.join(config.skillsDir, 'bab', 'SKILL.md'), 'utf8')).includes('# New'));
  await assert.rejects(applyUpdate(home, {...input, currentVersion: '0.2.0'}), /不自动/u);
});
