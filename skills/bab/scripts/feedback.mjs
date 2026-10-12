import {randomUUID, createHash} from 'node:crypto';
import path from 'node:path';
import {boundedString, mutateState, readState} from './store.mjs';
import {compareVersions, FEEDBACK_INTERVAL, retryDelay} from './check-policy.mjs';

const digest = input => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const redact = text => String(text).replace(/Bearer\s+[\w.+/=-]+/giu, 'Bearer [已隐藏]')
  .replace(/\b(?:sk-|ghp_|github_pat_)[\w-]+/gu, '[凭据已隐藏]')
  .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, '[邮箱已隐藏]')
  .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/gu, '[电话已隐藏]')
  .replace(/(?:\/Users\/|\/home\/)[^\s"'，。]+/gu, '[本地路径已隐藏]')
  .replace(/[A-Z]:\\Users\\[^\s"'，。]+/giu, '[本地路径已隐藏]');

export function endpointURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('反馈地址必须是无内嵌凭据的 HTTPS 地址。');
  return url.href;
}

export async function draftFeedback(home, input) {
  const fields = ['goal', 'expected', 'actual', 'steps', 'observed', 'hypothesis', 'suggestion'];
  const report = {id: randomUUID(), createdAt: new Date().toISOString(), version: boundedString(input.version, '版本', 100)};
  for (const key of fields) report[key] = redact(boundedString(input[key], key, 4000));
  report.excerpt = redact(String(input.excerpt || '').slice(0, 2000));
  report.skill = boundedString(input.skill, 'Skill', 100);
  report.environment = Object.fromEntries(['agent', 'os', 'runtime', 'installMethod'].map(key => [key, redact(String(input.environment?.[key] || '未提供').slice(0, 200))]));
  const endpoint = input.endpoint ? endpointURL(input.endpoint) : null;
  const approvalHash = digest({endpoint, report});
  const draft = {report, endpoint, approvalHash, status: 'draft'};
  await mutateState(home, s => s.feedback.push(draft));
  return {...draft, warning: '自动遮盖只覆盖常见模式。请逐项审阅，尤其是人物、客户、项目和商业数据。当前尚未发送。'};
}

export async function sendFeedback(home, id, approvalHash, {fetcher = fetch} = {}) {
  const state = await readState(home); const draft = state.feedback.find(d => d.report.id === id);
  if (!draft?.endpoint) throw new Error('尚未配置反馈地址，可先导出草稿。');
  if (draft.approvalHash !== approvalHash || digest({endpoint: draft.endpoint, report: draft.report}) !== approvalHash) throw new Error('反馈内容或接收地址已变，请重新展示并确认。');
  if (draft.status === 'sent') return {alreadySent: true, receipt: draft.receipt};
  const res = await fetcher(endpointURL(draft.endpoint), {method: 'POST', redirect: 'error',
    headers: {'content-type': 'application/json', 'idempotency-key': id},
    body: JSON.stringify(draft.report), signal: AbortSignal.timeout(5000)});
  if (!res.ok) throw new Error(`反馈未确认成功：HTTP ${res.status}。可按同一编号重试，避免重复提交。`);
  const text = await res.text(); if (text.length > 10000) throw new Error('反馈回执异常。');
  const receipt = JSON.parse(text);
  if (receipt.id !== id || !receipt.token) throw new Error('反馈回执缺少编号或查询凭证。');
  await mutateState(home, s => {const d = s.feedback.find(x => x.report.id === id); d.status = 'sent'; d.receipt = receipt;});
  return {sent: true, receipt};
}

const sentReceipt = row => row?.status === 'sent' && row.endpoint && row.receipt?.id === row.report?.id && typeof row.receipt?.token === 'string' && row.receipt.token.length > 0;
const baseline = {status: 'received', fixedIn: null, message: ''};
const unchangedReceipt = (row, before) => sentReceipt(row) && row.endpoint === before.endpoint && digest(row.receipt) === digest(before.receipt);

async function readFeedbackStatus(row, fetcher) {
  const id = row.report.id;
  const url = new URL(endpointURL(row.endpoint));
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/${encodeURIComponent(id)}`;
  const res = await fetcher(url, {method: 'GET', headers: {authorization: `Bearer ${row.receipt.token}`}, redirect: 'error', signal: AbortSignal.timeout(5000)});
  if (!res.ok) throw new Error(`查询失败：HTTP ${res.status}`);
  const reader = res.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.length; if (size > 16000) throw new Error('反馈状态响应过大。'); chunks.push(value);
    }
  } finally {await reader.cancel().catch(() => {});}
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (data.id !== id || !['received', 'working', 'waiting', 'resolved', 'closed'].includes(data.status)) throw new Error('反馈状态响应无效。');
  if (data.fixedIn != null) compareVersions(data.fixedIn, '0.0.0');
  if (data.status === 'resolved' && !data.fixedIn) throw new Error('已修复反馈缺少版本。');
  if (data.message != null && (typeof data.message !== 'string' || data.message.length > 4000)) throw new Error('反馈回复无效。');
  return {status: data.status, fixedIn: data.fixedIn ?? null, message: data.message || ''};
}

function releaseStatus(snapshot, currentVersion, verifiedVersion) {
  if (snapshot.status !== 'resolved') return 'not-applicable';
  if (currentVersion && compareVersions(currentVersion, snapshot.fixedIn) >= 0) return 'installed';
  if (verifiedVersion && compareVersions(verifiedVersion, snapshot.fixedIn) >= 0) return 'available';
  return 'unverified';
}
const notice = (snapshot, relation) => ({snapshotHash: digest(snapshot), releaseStatus: relation});
const noticeKey = (skillsDir, version) => digest(skillsDir ? ['installation', path.resolve(skillsDir)] : ['version', version || null]);

export async function feedbackStatus(home, id, {fetcher = fetch, now = Date.now(), currentVersion, skillsDir} = {}) {
  const state = await readState(home), before = state.feedback.find(x => x.report.id === id);
  if (!sentReceipt(before)) throw new Error('尚无已发送回执。');
  const snapshot = await readFeedbackStatus(before, fetcher);
  return mutateState(home, s => {
    const row = s.feedback.find(x => x.report.id === id);
    if (!unchangedReceipt(row, before) || digest(row.followup || {}) !== digest(before.followup || {})) throw new Error('反馈已删除、回执变化或已有新查询，未覆盖记录。');
    const relation = releaseStatus(snapshot, currentVersion);
    const key = noticeKey(skillsDir, currentVersion), notices = row.followup?.notices || {};
    const alreadyAvailable = relation === 'unverified' && row.followup?.snapshot?.fixedIn === snapshot.fixedIn && notices[key]?.releaseStatus === 'available';
    row.followup = {snapshot, lastCheck: now, lastSuccess: now, nextCheckAt: now + FEEDBACK_INTERVAL, failureCount: 0,
      notices: {...notices, [key]: notice(snapshot, alreadyAvailable ? 'available' : relation)}};
    return {id, ...snapshot, releaseStatus: relation, statusCheckedAt: now};
  });
}

export async function checkFeedback(home, {fetcher = fetch, now = Date.now(), force = false, currentVersion, verifiedVersion, skillsDir} = {}) {
  const state = await readState(home), sent = state.feedback.filter(sentReceipt);
  const key = noticeKey(skillsDir, currentVersion);
  if (!sent.length) return {status: 'empty', checked: 0, changes: [], failures: []};
  const due = sent.filter(row => force || now >= (row.followup?.nextCheckAt || 0))
    .sort((a, b) => (a.followup?.lastCheck || 0) - (b.followup?.lastCheck || 0)).slice(0, 3);
  const results = await Promise.all(due.map(async row => {
    try {return {row, snapshot: await readFeedbackStatus(row, fetcher)};}
    catch {return {row, failed: true};}
  }));
  const needsNotice = row => {
    const snapshot = row.followup?.snapshot || baseline;
    const previous = row.followup?.notices?.[key] || notice(baseline, 'not-applicable');
    const relation = releaseStatus(snapshot, currentVersion, verifiedVersion);
    // Losing network verification is not new progress; it must not re-arm the same notice.
    return digest(snapshot) !== previous.snapshotHash || (relation !== 'unverified' && relation !== previous.releaseStatus);
  };
  if (!results.length && !sent.some(needsNotice)) return {status: 'not-due', checked: 0, changes: [], failures: []};
  return mutateState(home, s => {
    const failures = [], changes = [], refreshed = new Set();
    for (const result of results) {
      const row = s.feedback.find(x => x.report.id === result.row.report.id);
      // A concurrent delete, manual check or newer result wins; never resurrect a receipt.
      if (!unchangedReceipt(row, result.row) || digest(row.followup || {}) !== digest(result.row.followup || {})) continue;
      const track = row.followup ||= {};
      track.lastCheck = now;
      if (result.failed) {
        track.failureCount = Math.min(3, (track.failureCount || 0) + 1);
        track.nextCheckAt = now + retryDelay(track.failureCount);
        failures.push({id: row.report.id, message: '暂未取得有效反馈状态，保留上次结果。', nextCheckAt: track.nextCheckAt});
      } else {
        track.snapshot = result.snapshot; track.lastSuccess = now;
        track.failureCount = 0; track.nextCheckAt = now + FEEDBACK_INTERVAL;
        refreshed.add(row.report.id);
      }
    }
    for (const row of s.feedback.filter(sentReceipt)) {
      if (!sent.some(before => before.report.id === row.report.id && unchangedReceipt(row, before)) || !needsNotice(row)) continue;
      const snapshot = row.followup?.snapshot || baseline;
      const relation = releaseStatus(snapshot, currentVersion, verifiedVersion);
      row.followup ||= {};
      row.followup.notices ||= {};
      row.followup.notices[key] = notice(snapshot, relation);
      changes.push({id: row.report.id, goal: row.report.goal, ...snapshot, releaseStatus: relation,
        statusCheckedAt: row.followup.lastSuccess, cached: !refreshed.has(row.report.id)});
    }
    return {status: results.length ? 'checked' : 'not-due', checked: results.length, changes, failures};
  });
}

export async function recordCorrection(home, taskId, input) {
  boundedString(taskId, '任务编号', 100);
  if (!input.explicit || !input.problemKey) return {suggestFeedback: false};
  return mutateState(home, s => {
    const key = digest([taskId, boundedString(input.problemKey, '同一问题', 500)]);
    const row = s.tasks[key] ||= {corrections: 0, offered: false};
    row.corrections++; row.updatedAt = new Date().toISOString();
    const suggestFeedback = row.corrections >= 3 && !row.offered;
    if (suggestFeedback) row.offered = true;
    return {corrections: row.corrections, suggestFeedback, instruction: '先修正本次问题；只建议一次，不自动发送。'};
  });
}

export async function resourceGate(home, {id, relevant, evidence, disable = false}, now = Date.now()) {
  return mutateState(home, s => {
    if (disable) {s.settings.resources = false; return {show: false, disabled: true};}
    if (!s.settings.resources || !relevant || !evidence) return {show: false};
    boundedString(id, '资料编号', 100);
    const last = Math.max(0, ...Object.values(s.resources));
    if (s.resources[id] || now - last < 14 * 86400000) return {show: false};
    s.resources[id] = now; return {show: true, evidence};
  });
}
