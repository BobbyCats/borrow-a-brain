import {randomUUID, createHash} from 'node:crypto';
import {boundedString, mutateState, readState} from './store.mjs';

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

export async function feedbackStatus(home, id, {fetcher = fetch} = {}) {
  const state = await readState(home); const row = state.feedback.find(x => x.report.id === id);
  if (!row?.receipt || !row.endpoint) throw new Error('尚无已发送回执。');
  const url = new URL(`${row.endpoint.replace(/\/$/u, '')}/${encodeURIComponent(id)}`);
  const res = await fetcher(url, {headers: {authorization: `Bearer ${row.receipt.token}`}, redirect: 'error', signal: AbortSignal.timeout(5000)});
  if (!res.ok) throw new Error(`查询失败：HTTP ${res.status}`);
  return res.json();
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
