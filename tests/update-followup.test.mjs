import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync, sign, createHash} from 'node:crypto';
import {checkUpdate} from '../skills/bab/scripts/update.mjs';
import {checkFeedback, draftFeedback, sendFeedback, feedbackStatus} from '../skills/bab/scripts/feedback.mjs';
import {readState, mutateState} from '../skills/bab/scripts/store.mjs';

const HOUR = 3600000, DAY = 24 * HOUR, NOW = Date.parse('2026-10-12T00:00:00Z');
const json = value => new Response(JSON.stringify(value));
async function sandbox(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bab-followup-'));
  t.after(() => fs.rm(home, {recursive: true, force: true})); return home;
}
function release(version = '0.1.9') {
  const {publicKey, privateKey} = generateKeyPairSync('ed25519');
  const files = [['skills/bab/SKILL.md', '# Synthetic'], ['skills/bab/assets/version.json', JSON.stringify({version})]]
    .map(([path, text]) => ({path, content: Buffer.from(text).toString('base64'), sha256: createHash('sha256').update(text).digest('hex')}));
  const bytes = Buffer.from(JSON.stringify({schema: 1, version, notes: 'Synthetic fix', files}));
  return {config: {sources: ['https://updates.example.test/latest.json'], publicKey: publicKey.export({format: 'pem', type: 'spki'})},
    envelope: {payload: bytes.toString('base64'), signature: sign(null, bytes, privateKey).toString('base64')}};
}
async function report(home, sent = true) {
  const draft = await draftFeedback(home, {version: '0.1.8', skill: 'bab', goal: '合成测试目标', expected: '预期', actual: '现象', steps: '步骤', observed: '事实', hypothesis: '待验证', suggestion: '建议', endpoint: 'https://feedback.example.test/v1/feedback?channel=test'});
  if (sent) await sendFeedback(home, draft.report.id, draft.approvalHash, {fetcher: async () => json({id: draft.report.id, token: 'synthetic-private-token'})});
  return draft.report.id;
}
const responseFor = (id, status = 'resolved', fixedIn = '0.1.9', message = '') => ({id, status, fixedIn: status === 'resolved' ? fixedIn : null, message});

test('失败按1/6/24小时退避，成功恢复七天；force不覆盖上次成功时间', async t => {
  const home = await sandbox(t), {config, envelope} = release(); let calls = 0, online = false;
  const fetcher = async () => {calls++; if (!online) throw new Error('offline'); return json(envelope);};
  const check = (now, extra = {}) => checkUpdate(home, config, '0.1.8', {now, fetcher, ...extra});
  assert.equal((await check(NOW)).nextCheckAt, NOW + HOUR);
  assert.equal((await check(NOW + HOUR - 1)).status, 'not-due'); assert.equal(calls, 1);
  assert.equal((await check(NOW + HOUR)).nextCheckAt, NOW + 7 * HOUR);
  assert.equal((await check(NOW + 7 * HOUR)).nextCheckAt, NOW + 31 * HOUR);
  assert.equal((await check(NOW + 31 * HOUR)).nextCheckAt, NOW + 55 * HOUR);
  online = true;
  assert.equal((await check(NOW + 55 * HOUR)).status, 'available');
  let row = Object.values((await readState(home)).maintenance.checks)[0];
  assert.equal(row.failureCount, 0); assert.equal(row.lastSuccess, NOW + 55 * HOUR);
  assert.equal((await check(NOW + 55 * HOUR + 7 * DAY - 1)).status, 'not-due');
  assert.equal((await check(NOW + 55 * HOUR + 7 * DAY)).status, 'available');
  const lastSuccess = Object.values((await readState(home)).maintenance.checks)[0].lastSuccess;
  online = false;
  assert.equal((await check(lastSuccess + 1, {force: true})).status, 'offline-or-invalid');
  row = Object.values((await readState(home)).maintenance.checks)[0];
  assert.equal(row.lastSuccess, lastSuccess); assert.equal(row.nextCheckAt, lastSuccess + 1 + HOUR);
  assert.equal((await check(lastSuccess + 2)).verifiedVersion, undefined);
});

test('主源失败备用源验签成功仍按成功计时；草稿即使伪带回执也不查询', async t => {
  const home = await sandbox(t), {config, envelope} = release();
  const id = await report(home, false);
  await mutateState(home, s => {s.feedback[0].receipt = {id, token: 'fake'};});
  config.sources.unshift('https://unavailable.example.test/latest.json');
  const calls = [];
  const result = await checkUpdate(home, config, '0.1.8', {now: NOW, fetcher: async url => {
    calls.push(url.hostname); if (url.hostname === 'unavailable.example.test') throw new Error('offline'); return json(envelope);
  }});
  assert.equal(result.status, 'available'); assert.equal(result.nextCheckAt, NOW + 7 * DAY);
  assert.deepEqual(calls, ['unavailable.example.test', 'updates.example.test']); assert.equal(result.feedback.status, 'empty');
});

test('更新未到期仍查询反馈，只GET已有回执并关联可信版本；相同结果不重复提醒', async t => {
  const home = await sandbox(t), {config, envelope} = release(); let updateCalls = 0, feedbackCalls = 0, id;
  const fetcher = async (url, options) => {
    if (url.hostname === 'updates.example.test') {updateCalls++; return json(envelope);}
    feedbackCalls++; assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'error'); assert.equal(url.search, '?channel=test');
    assert.equal(options.headers.authorization, 'Bearer synthetic-private-token');
    return json({...responseFor(id), token: 'never-return', note: 'private note'});
  };
  assert.equal((await checkUpdate(home, config, '0.1.8', {now: NOW, fetcher})).feedback.status, 'empty');
  id = await report(home);
  const result = await checkUpdate(home, config, '0.1.8', {now: NOW + 1, fetcher});
  assert.equal(result.status, 'not-due'); assert.equal(result.feedback.changes[0].releaseStatus, 'available');
  assert.equal(result.feedback.changes[0].fixedIn, '0.1.9'); assert.equal(updateCalls, 1); assert.equal(feedbackCalls, 1);
  assert(!JSON.stringify(result.feedback).includes('never-return')); assert(!JSON.stringify(result.feedback).includes('private note'));
  assert.equal((await checkUpdate(home, config, '0.1.8', {now: NOW + DAY, fetcher})).feedback.changes.length, 0);
  assert.equal(feedbackCalls, 1);
  assert.equal((await checkUpdate(home, config, '0.1.8', {now: NOW + DAY + 1, fetcher})).feedback.changes.length, 0);
  assert.equal(feedbackCalls, 2);
});

test('反馈未到期也重算修复关联；签名失败不会用旧缓存宣称可升级或重新催促', async t => {
  const home = await sandbox(t), first = release('0.1.8'), second = release('0.1.9'), id = await report(home); let gets = 0;
  const fetcher = envelope => async url => {
    if (url.hostname === 'updates.example.test') return json(envelope);
    gets++; return json(responseFor(id));
  };
  assert.equal((await checkUpdate(home, first.config, '0.1.8', {now: NOW, fetcher: fetcher(first.envelope)})).feedback.changes[0].releaseStatus, 'unverified');
  const available = await checkUpdate(home, second.config, '0.1.8', {now: NOW + 1, fetcher: fetcher(second.envelope)});
  assert.equal(available.feedback.changes[0].releaseStatus, 'available'); assert.equal(available.feedback.changes[0].cached, true); assert.equal(gets, 1);
  const invalid = await checkUpdate(home, second.config, '0.1.8', {now: NOW + 2, force: true, fetcher: fetcher({...second.envelope, signature: 'bad'})});
  assert.equal(invalid.status, 'offline-or-invalid'); assert.equal(invalid.verifiedVersion, undefined); assert.equal(invalid.feedback.changes.length, 0);
  assert.equal((await checkUpdate(home, second.config, '0.1.8', {now: NOW + 3, force: true, fetcher: fetcher(second.envelope)})).feedback.changes.length, 0);
  const installed = await checkUpdate(home, second.config, '0.1.9', {now: NOW + 4, fetcher: fetcher(second.envelope)});
  assert.equal(installed.feedback.changes[0].releaseStatus, 'installed'); assert.equal(installed.feedback.changes[0].cached, true);
  assert.equal((await readState(home)).feedback[0].status, 'sent');
});

test('未配置更新或更新失败仍跟进反馈；无签名证据与旧记录均不能声称版本可下载', async t => {
  for (const mode of ['unconfigured', 'invalid', 'legacy']) {
    const home = await sandbox(t), id = await report(home), {config, envelope} = release();
    if (mode === 'legacy') {
      await checkUpdate(home, config, '0.1.8', {now: NOW, fetcher: async url => url.hostname === 'updates.example.test' ? json(envelope) : json(responseFor(id, 'received'))});
      await mutateState(home, s => {for (const row of Object.values(s.maintenance.checks)) {delete row.lastSuccess; delete row.verifiedVersion; delete row.nextCheckAt;} delete s.feedback[0].followup;});
    }
    const result = await checkUpdate(home, mode === 'unconfigured' ? {} : config, '0.1.8', {now: NOW + 1, fetcher: async url => {
      if (url.hostname === 'updates.example.test') return json({...envelope, signature: 'bad'});
      return json(responseFor(id));
    }});
    assert.equal(result.feedback.changes[0].releaseStatus, 'unverified', mode);
  }
});

test('基线仅压下无回复的received；最多三条且后续调用覆盖剩余；手动查询共用去重', async t => {
  const home = await sandbox(t), ids = [];
  for (let i = 0; i < 4; i++) ids.push(await report(home));
  const statuses = ['received', 'working', 'waiting', 'received'];
  const fetcher = async url => {const id = url.pathname.split('/').at(-1), i = ids.indexOf(id); return json(responseFor(id, statuses[i], null, i === 3 ? '需要补充材料' : ''));};
  const first = await checkFeedback(home, {now: NOW, fetcher});
  assert.equal(first.checked, 3); assert.equal(first.changes.length, 2);
  const next = await checkFeedback(home, {now: NOW + 1, fetcher});
  assert.equal(next.checked, 1); assert.equal(next.changes[0].id, ids[3]);
  statuses[0] = 'working';
  assert.equal((await feedbackStatus(home, ids[0], {now: NOW + 2, fetcher})).status, 'working');
  assert.equal((await checkFeedback(home, {now: NOW + 3, fetcher})).changes.length, 0);
});

test('非法反馈响应与404独立失败，不覆盖有效快照；退避后可恢复', async t => {
  const home = await sandbox(t), id = await report(home), other = await report(home);
  await checkFeedback(home, {now: NOW, fetcher: async url => json(responseFor(url.pathname.split('/').at(-1), 'working'))});
  const bad = [() => json({id: 'wrong', status: 'received'}), () => json({id, status: 'invented'}),
    () => json({id, status: 'resolved', fixedIn: 'future'}), () => json({id, status: 'resolved'}),
    () => json({id, status: 'received', message: 'x'.repeat(4001)}), () => new Response('x'.repeat(16001)),
    () => new Response('', {status: 404}), () => {throw new Error('network');}];
  let now = NOW;
  for (const response of bad) {
    now++;
    const result = await checkFeedback(home, {force: true, now, fetcher: async url => url.pathname.endsWith(id) ? response() : json(responseFor(other, 'resolved', '0.1.9'))});
    assert.equal(result.failures.length, 1); assert.equal((await readState(home)).feedback[0].followup.snapshot.status, 'working');
  }
  const calls = await checkFeedback(home, {now: now + DAY - 1, fetcher: async () => {throw new Error('must not call');}});
  assert.equal(calls.checked, 0);
  const recovered = await checkFeedback(home, {now: now + DAY, fetcher: async url => json(responseFor(url.pathname.split('/').at(-1), 'working'))});
  assert.equal(recovered.failures.length, 0); assert.equal((await readState(home)).feedback[0].followup.failureCount, 0);
});

test('并发只提示一次；查询中删除不复活；只改变维护与反馈跟踪字段', async t => {
  const home = await sandbox(t), id = await report(home);
  await mutateState(home, s => {s.profiles = [{id: 'synthetic-method', activeVersion: 'v0002'}]; s.rules = [{synthetic: true}]; s.grants = [{synthetic: true}]; s.installations = [{version: '0.1.8'}];});
  const before = await readState(home);
  let release; const gate = new Promise(r => {release = r;}); let requests = 0, started;
  const ready = new Promise(r => {started = r;});
  const fetcher = async () => {if (++requests === 2) started(); await gate; return json(responseFor(id, 'working'));};
  const first = checkFeedback(home, {now: NOW, fetcher}), second = checkFeedback(home, {now: NOW, fetcher});
  await ready; release(); const results = await Promise.all([first, second]);
  assert.equal(results.flatMap(x => x.changes).length, 1);
  const after = await readState(home);
  for (const key of ['profiles', 'rules', 'grants', 'installations', 'settings', 'tasks']) assert.deepEqual(after[key], before[key]);
  const {followup, ...original} = after.feedback[0]; assert.deepEqual(original, before.feedback[0]);
  const deleted = await checkFeedback(home, {force: true, now: NOW + 1, fetcher: async () => {
    await mutateState(home, s => {s.feedback = [];}); return json(responseFor(id));
  }});
  assert.equal(deleted.changes.length, 0); assert.deepEqual((await readState(home)).feedback, []);
});

test('手动查询不重置已有升级提醒；多安装各自去重，当前安装升级只新增一次复测提示', async t => {
  const home = await sandbox(t), id = await report(home), {config, envelope} = release();
  const fetcher = async url => json(url.hostname === 'updates.example.test' ? envelope : responseFor(id));
  const a = {skillsDir: path.join(home, 'A/skills'), now: NOW, fetcher};
  const b = {...a, skillsDir: path.join(home, 'B/skills')};
  assert.equal((await checkUpdate(home, config, '0.1.8', a)).feedback.changes[0].releaseStatus, 'available');
  await feedbackStatus(home, id, {...a, currentVersion: '0.1.8'});
  assert.equal((await checkUpdate(home, config, '0.1.8', a)).feedback.changes.length, 0);
  assert.equal((await checkUpdate(home, config, '0.1.9', b)).feedback.changes[0].releaseStatus, 'installed');
  for (let i = 0; i < 2; i++) {
    assert.equal((await checkUpdate(home, config, '0.1.8', a)).feedback.changes.length, 0);
    assert.equal((await checkUpdate(home, config, '0.1.9', b)).feedback.changes.length, 0);
  }
  assert.equal((await checkUpdate(home, config, '0.1.9', a)).feedback.changes[0].releaseStatus, 'installed');
  assert.equal((await checkUpdate(home, config, '0.1.9', a)).feedback.changes.length, 0);
});

test('并发检查晚到的旧结果不覆盖已经完成的成功记录，也不重复提示', async t => {
  for (const lateFailure of [true, false]) {
    const home = await sandbox(t), {config, envelope} = release();
    let unblock, started;
    const gate = new Promise(resolve => {unblock = resolve;});
    const ready = new Promise(resolve => {started = resolve;});
    const older = checkUpdate(home, config, '0.1.8', {now: NOW, fetcher: async () => {
      started(); await gate; if (lateFailure) throw new Error('offline'); return json(envelope);
    }});
    await ready;
    const newer = await checkUpdate(home, config, '0.1.8', {now: NOW + 1, fetcher: async () => json(envelope)});
    assert.equal(newer.status, 'available'); assert.equal(newer.notify, true);
    const before = (await readState(home)).maintenance;
    unblock(); const stale = await older;
    assert.equal(stale.status, 'not-due'); assert.equal(stale.reason, 'concurrent-check');
    assert.equal(stale.verifiedVersion, '0.1.9'); assert.equal(stale.notify, undefined);
    assert.deepEqual((await readState(home)).maintenance, before);
    const cached = await checkUpdate(home, config, '0.1.8', {now: NOW + 2, fetcher: async () => {throw new Error('must not fetch');}});
    assert.equal(cached.verifiedVersion, '0.1.9'); assert.equal(cached.nextCheckAt, NOW + 1 + 7 * DAY);
  }
});
