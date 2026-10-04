import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {feedbackServer, markResolved} from '../server/feedback.mjs';

test('私有反馈 API：收件、幂等、授权查询、后台访问与修复版本', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bab-inbox-'));
  const token = 'test-admin-token-at-least-32-characters';
  const server = feedbackServer({home, adminToken: token});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {await new Promise(resolve => server.close(resolve)); await fs.rm(home, {recursive: true, force: true});});
  const base = `http://127.0.0.1:${server.address().port}`;
  const report = {id: randomUUID(), version: '0.1.0', skill: 'bab', goal: '完成报告', expected: '先给结论', actual: '反复提问', steps: '请求直接写稿', observed: '合成测试出现三次', hypothesis: '待验证', suggestion: '调整路由'};
  const post = body => fetch(base + '/v1/feedback', {method: 'POST', headers: {'content-type': 'application/json', 'idempotency-key': report.id}, body: JSON.stringify(body)});
  const first = await post(report); assert.equal(first.status, 201); const receipt = await first.json();
  const second = await post(report); assert.deepEqual(await second.json(), receipt);
  assert.equal((await post({...report, goal: 'different'})).status, 409);
  assert.equal((await fetch(base + '/admin/feedback')).status, 401);
  const inbox = await fetch(base + '/admin/feedback', {headers: {authorization: `Bearer ${token}`}});
  const body = await inbox.json(); assert.equal(body.items.length, 1); assert.equal(body.items[0].report.goal, '完成报告'); assert.equal(body.items[0].token, undefined);
  assert.equal((await fetch(`${base}/v1/feedback/${report.id}`)).status, 404);
  await markResolved(home, report.id, '0.2.0');
  const status = await fetch(`${base}/v1/feedback/${report.id}`, {headers: {authorization: `Bearer ${receipt.token}`}});
  assert.deepEqual(await status.json(), {id: report.id, status: 'resolved', fixedIn: '0.2.0'});
});

test('反馈接口拒绝无效结构，限制同来源请求', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bab-inbox-'));
  const server = feedbackServer({home, adminToken: 'x'.repeat(32), maxPerHour: 1});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {await new Promise(resolve => server.close(resolve)); await fs.rm(home, {recursive: true, force: true});});
  const url = `http://127.0.0.1:${server.address().port}/v1/feedback`;
  assert.equal((await fetch(url, {method: 'POST', body: '{}'})).status, 400);
  assert.equal((await fetch(url, {method: 'POST', body: '{}'})).status, 429);
});
