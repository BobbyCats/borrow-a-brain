import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readState, mutateState} from './store.mjs';
import {readConfig} from './config.mjs';

const hosts = new Set(['codex','claude','workbuddy','other']);
const locate = (s, dir) => s.installations?.find(x => x.skillsDir === path.resolve(dir));
export async function metricsStatus(home, skillsDir) {
  const row = locate(await readState(home), skillsDir);
  return {installed: !!row, choice: row?.metrics?.choice ?? 'unset', enabled: row?.metrics?.choice === 'enabled',
    firstUseRecorded: !!row?.metrics?.firstUse, note: '自愿统计；不发送聊天、方法、文件内容、路径或用户身份。关闭不影响使用。'};
}
export async function metricsConsent(home, input, options = {}) {
  if (typeof input.enabled !== 'boolean' || input.enabled && input.userApproved !== true) throw new Error('开启统计需要用户明确同意；关闭不需要额外确认。');
  if (!input.skillsDir || !hosts.has(input.host ?? 'other')) throw new Error('需要有效安装目录和宿主名称。');
  await mutateState(home, s => {
    const row = locate(s, input.skillsDir); if (!row) throw new Error('没有已完成的安装回执。');
    row.metrics ||= {}; row.metrics.choice = input.enabled ? 'enabled' : 'disabled';
    if (input.enabled) {row.metrics.id ||= randomUUID(); row.metrics.host = input.host ?? row.metrics.host ?? 'other';}
    else row.metrics.pending = []; // withdrawn consent cancels unsent events
  });
  return {enabled: input.enabled, receipt: input.enabled ? await flushMetrics(home, input.skillsDir, options) : {status:'disabled'}};
}
function event(row, name, options) {
  return {schema:1, id:randomUUID(), installationId:row.metrics.id, event:name, version:row.version,
    os:process.platform, host:row.metrics.host || 'other', occurredAt:new Date().toISOString(),
    ...(options.test ? {test:true} : {})};
}
export async function markFirstUse(home, skillsDir, {confirmed = false, ...options} = {}) {
  if (!confirmed) throw new Error('只能在宿主完成首次实际任务后确认，安装、加载文件或查询目录不算首次任务成功。');
  await mutateState(home, s => {
    const row = locate(s, skillsDir);
    if (row?.metrics?.choice === 'enabled') row.metrics.firstUse ||= new Date().toISOString();
  });
  return flushMetrics(home, skillsDir, options);
}
export async function flushMetrics(home, skillsDir, {fetcher = fetch, endpoint, test = false} = {}) {
  try {
    const row = locate(await readState(home), skillsDir);
    if (row?.metrics?.choice !== 'enabled') return {status:'disabled'};
    endpoint ??= (await readConfig(home)).config.metricsEndpoint;
    if (!endpoint) return {status:'unconfigured'};
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('统计地址必须是无凭据的 HTTPS 地址。');
    const pending = await mutateState(home, s => {
      const row = locate(s, skillsDir); if (row?.metrics?.choice !== 'enabled') return [];
      const m = row.metrics; m.sent ||= {}; m.pending ||= [];
      const add = name => {const key = name === 'update_success' ? name + ':' + row.version : name;
        if (!m.sent[key] && !m.pending.some(x => x.key === key)) m.pending.push({key, payload:event(row,name,{test})});};
      // Existing installations first seen after an upgrade are never counted as new installs.
      add(row.metricsEligibleNew ? 'install_success' : 'existing_install_observed');
      if (m.lastVersion && m.lastVersion !== row.version) add('update_success');
      if (m.firstUse) add('first_use_success');
      return m.pending.slice(0,4);
    });
    let sent = 0;
    for (const item of pending) {
      // Consent may be revoked while another CLI is running.
      if (locate(await readState(home), skillsDir)?.metrics?.choice !== 'enabled') break;
      const response = await fetcher(url, {method:'POST',redirect:'error',signal:AbortSignal.timeout(3000),
        headers:{'content-type':'application/json','idempotency-key':item.payload.id},body:JSON.stringify(item.payload)});
      if (!response.ok) throw new Error('统计服务暂不可用');
      const receipt = await response.json();
      if (receipt.accepted !== true || receipt.id !== item.payload.id) throw new Error('统计回执无效');
      await mutateState(home,s=>{const row=locate(s,skillsDir);if(row?.metrics?.choice!=='enabled')return;
        row.metrics.sent[item.key]=true;row.metrics.pending=row.metrics.pending.filter(x=>x.payload.id!==item.payload.id);row.metrics.lastVersion=item.payload.version;});
      sent++;
    }
    return {status:'ok',sent};
  } catch {return {status:'pending',note:'统计未发送，将在后续使用时重试；不影响当前任务。'};}
}
