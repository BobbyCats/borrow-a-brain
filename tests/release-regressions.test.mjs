import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {generateKeyPairSync, sign, createHash} from 'node:crypto';
import {setup} from '../skills/bab/scripts/setup.mjs';
import {install, uninstall} from '../skills/bab/scripts/install.mjs';
import {readState, mutateState} from '../skills/bab/scripts/store.mjs';
import {saveRoute, checkpointRoute, loadRoute, listRoutes} from '../skills/bab/scripts/routing.mjs';
import {checkUpdate} from '../skills/bab/scripts/update.mjs';
import {draftFeedback, sendFeedback, feedbackStatus} from '../skills/bab/scripts/feedback.mjs';

async function sandbox(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'bab-regression-')));
  t.after(() => fs.rm(root, {recursive: true, force: true})); return root;
}
async function fixture(root, version) {
  const source = path.join(root, 'source', 'skills');
  await fs.mkdir(path.join(source, 'bab/assets'), {recursive: true});
  await fs.writeFile(path.join(source, 'bab/SKILL.md'), '# Synthetic skill');
  await fs.writeFile(path.join(source, 'bab/assets/version.json'), JSON.stringify({version}));
  return source;
}
const directoryLink = (target, name) => fs.symlink(target, name, process.platform === 'win32' ? 'junction' : 'dir');

test('项目安装解析目录链接：预览和执行均不越过选择的项目', async t => {
  const root = await sandbox(t), home = path.join(root, 'data');
  for (const nested of [false, true]) {
    const project = path.join(root, nested ? 'nested-project' : 'project');
    const shared = path.join(root, nested ? 'nested-shared' : 'shared');
    await fs.mkdir(project); await fs.mkdir(shared);
    if (nested) await fs.mkdir(path.join(project, '.agents'));
    await directoryLink(shared, path.join(project, nested ? '.agents/skills' : '.agents'));
    for (const apply of [false, true]) await assert.rejects(setup(home, {host: 'codex', project, apply}), /越过已选择的范围/u);
    assert.deepEqual(await fs.readdir(shared), []);
    await assert.rejects(fs.stat(path.join(project, 'AGENTS.md')), {code: 'ENOENT'});
  }
  assert.equal((await readState(home)).installations, undefined);
});

test('规则目录越界也拒绝；安装后目录链接改变不能卸载错误位置', async t => {
  const root = await sandbox(t), home = path.join(root, 'data'), project = path.join(root, 'project'), shared = path.join(root, 'shared');
  await fs.mkdir(project); await fs.mkdir(shared);
  const source = await fixture(root, '0.1.3');
  await directoryLink(shared, path.join(project, 'rules'));
  const input = {source, skillsDir: path.join(project, 'skills'), rulesFile: path.join(project, 'rules/AGENTS.md'), scopeRoot: project};
  await assert.rejects(install(home, input), /越过已选择的范围/u);
  input.rulesFile = path.join(project, 'AGENTS.md');
  const installed = await install(home, {...input, apply: true});
  assert.equal(installed.resolvedPaths.skillsDir, input.skillsDir);
  await fs.rename(input.skillsDir, path.join(shared, 'skills'));
  await directoryLink(path.join(shared, 'skills'), input.skillsDir);
  await assert.rejects(uninstall(home, input.skillsDir), /越过已选择的范围/u);
  assert.equal((await readState(home)).installations.length, 1);
  assert.equal(await fs.readFile(path.join(shared, 'skills/bab/SKILL.md'), 'utf8'), '# Synthetic skill');
});

test('安装从包读取版本；传入旧版本在写入前拒绝，旧回执仍可正常更新', async t => {
  const root = await sandbox(t), home = path.join(root, 'data'), source = await fixture(root, '0.1.3');
  const input = {source, skillsDir: path.join(root, 'project/skills'), rulesFile: path.join(root, 'project/AGENTS.md')};
  for (const apply of [false, true]) await assert.rejects(install(home, {...input, version: '0.1.1', apply}), /版本不一致/u);
  await assert.rejects(fs.stat(home), {code: 'ENOENT'});
  assert.equal((await install(home, input)).version, '0.1.3');
  await install(home, {...input, apply: true});
  assert.equal((await readState(home)).installations[0].version, '0.1.3');
  // Older receipts have neither resolvedPaths nor scopeRoot; code updates must preserve them.
  await mutateState(home, s => {delete s.installations[0].resolvedPaths; delete s.installations[0].scopeRoot; s.rules.push({synthetic: true});});
  await fs.writeFile(path.join(source, 'bab/assets/version.json'), JSON.stringify({version: '0.1.4'}));
  await install(home, {...input, apply: true});
  const state = await readState(home);
  assert.equal(state.installations[0].version, '0.1.4'); assert.deepEqual(state.rules, [{synthetic: true}]);
});

test('相同分工重存保留进度；改变目标后保留并标记待复核，重写进度才解除', async t => {
  const home = await sandbox(t), input = {taskId: 'synthetic-task', scope: 'project:A', intent: '通知交付时间', deliverable: '一段短消息', selected: []};
  const checkpoint = {scope: input.scope, status: 'done', summary: '已核对虚构订单数量', next: '等待对方确认'};
  await saveRoute(home, input); await checkpointRoute(home, input.taskId, checkpoint);
  const before = (await loadRoute(home, input.taskId, input.scope)).plan.checkpoint;
  await saveRoute(home, input);
  assert.deepEqual((await loadRoute(home, input.taskId, input.scope)).plan.checkpoint, before);
  const changed = {...input, deliverable: '一份正式说明'};
  await saveRoute(home, changed);
  const loaded = await loadRoute(home, input.taskId, input.scope);
  assert.equal(loaded.status, 'needs-review'); assert.equal(loaded.plan.checkpoint.summary, before.summary);
  assert.equal((await listRoutes(home, {scope: input.scope}))[0].checkpoint.needsReview, true);
  await saveRoute(home, changed); assert.equal((await loadRoute(home, input.taskId, input.scope)).status, 'needs-review');
  await checkpointRoute(home, input.taskId, {...checkpoint, status: 'active', next: '核对正式说明'});
  assert.equal((await loadRoute(home, input.taskId, input.scope)).status, 'ready');
});

test('更新检查和提醒按安装区分：新版、两份同版本旧安装互不压制', async t => {
  const root = await sandbox(t), home = path.join(root, 'data');
  const {publicKey, privateKey} = generateKeyPairSync('ed25519');
  const files = [['skills/bab/SKILL.md', '# Synthetic'], ['skills/bab/assets/version.json', JSON.stringify({version: '0.1.3'})]]
    .map(([path, text]) => ({path, content: Buffer.from(text).toString('base64'), sha256: createHash('sha256').update(text).digest('hex')}));
  const payload = Buffer.from(JSON.stringify({schema: 1, version: '0.1.3', notes: 'Synthetic update', files}));
  const envelope = {payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64')};
  const config = {sources: ['https://updates.example.test/latest.json'], publicKey: publicKey.export({format: 'pem', type: 'spki'})};
  const now = Date.now(), fetcher = async () => new Response(JSON.stringify(envelope));
  await mutateState(home, s => {s.maintenance = {lastCheck: now, notifiedVersion: '0.1.3'};});
  const installs = [];
  for (const [name, version] of [['A', '0.1.3'], ['B', '0.1.2'], ['C', '0.1.2']]) {
    const source = await fixture(path.join(root, name), version), skillsDir = path.join(root, name, 'project/skills');
    await install(home, {source, skillsDir, rulesFile: path.join(root, name, 'project/AGENTS.md'), apply: true});
    installs.push({skillsDir, version});
  }
  const check = (i, extra = {}) => checkUpdate(home, config, installs[i].version, {skillsDir: installs[i].skillsDir, now, fetcher, ...extra});
  assert.equal((await check(0)).status, 'current');
  assert.equal((await check(1)).notify, true); assert.equal((await check(1)).status, 'not-due');
  assert.equal((await check(2)).notify, true);
  assert.equal((await check(1, {force: true})).notify, false);
  assert.equal((await check(0, {now: now + 8 * 86400000})).status, 'current');
  assert.equal((await check(1, {now: now + 8 * 86400000})).status, 'available');
});

test('反馈查询只追加路径，保留渠道参数和原端点', async t => {
  const home = await sandbox(t);
  for (const endpoint of ['https://feedback.example.test/v1/feedback', 'https://feedback.example.test/v1/feedback?channel=preview', 'https://feedback.example.test/v1/feedback/?channel=a%2Fb&lang=zh']) {
    const draft = await draftFeedback(home, {endpoint, version: '0.1.3', skill: 'bab', goal: '虚构目标', expected: '预期', actual: '现象', steps: '步骤', observed: '事实', hypothesis: '待验证', suggestion: '建议'});
    await sendFeedback(home, draft.report.id, draft.approvalHash, {fetcher: async () => new Response(JSON.stringify({id: draft.report.id, token: 'synthetic-token'}))});
    const original = new URL(endpoint);
    const receipt = await feedbackStatus(home, draft.report.id, {fetcher: async (url, options) => {
      assert.equal(url.origin, original.origin); assert.equal(url.search, original.search);
      assert.equal(url.pathname, `${original.pathname.replace(/\/$/u, '')}/${draft.report.id}`);
      assert.equal(options.headers.authorization, 'Bearer synthetic-token');
      return new Response(JSON.stringify({status: 'received'}));
    }});
    assert.equal(receipt.status, 'received');
  }
});
