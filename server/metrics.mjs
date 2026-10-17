import {readState,mutateState} from '../skills/bab/scripts/store.mjs';
import {createHash} from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const kinds=new Set(['install_success','existing_install_observed','update_success','first_use_success']);
export function validateReceipt(input) {
  const keys=['schema','id','installationId','event','version','os','host','occurredAt','test'];
  if (!input || Object.keys(input).some(k=>!keys.includes(k)) || input.schema!==1 || !uuid.test(input.id) || !uuid.test(input.installationId) || !kinds.has(input.event) || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(input.version) || !['darwin','linux','win32'].includes(input.os) || !['codex','claude','workbuddy','other'].includes(input.host) || typeof input.occurredAt!=='string' || !Number.isFinite(Date.parse(input.occurredAt)) || input.test!==undefined && typeof input.test!=='boolean') throw Object.assign(Error('invalid-receipt'),{status:400});
  return Object.fromEntries(keys.filter(k=>input[k]!==undefined).map(k=>[k,input[k]]));
}
export async function receiveMetrics(home,input,now=new Date()) {
  const data=validateReceipt(input), digest=createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return mutateState(home,s=>{
    s.receipts ||= {}; s.receiptIds ||= {};
    const prior=s.receiptIds[data.id];
    if(prior && prior!==digest) throw Object.assign(Error('id-conflict'),{status:409});
    const key=[data.test?'test':'production',data.installationId,data.event,data.event==='update_success'?data.version:''].join(':');
    const duplicate=!!s.receipts[key];
    if(!duplicate) s.receipts[key]={...data,receivedAt:now.toISOString()};
    // Only keep IDs for stored events. Semantic duplicates don't create unlimited extra identifiers.
    if(!duplicate) s.receiptIds[data.id]=digest;
    return {accepted:true,id:data.id,duplicate};
  });
}
export async function metricsSummary(home) {
  const state=await readState(home), rows=Object.values(state.receipts||{}), live=rows.filter(x=>!x.test);
  const totals=Object.fromEntries([...kinds].map(k=>[k,live.filter(x=>x.event===k).length]));
  const groups=new Map();
  for(const r of live){const day=new Date(Date.parse(r.receivedAt)+8*3600000).toISOString().slice(0,10),key=[day,r.event,r.version,r.os,r.host].join('|');
    const row=groups.get(key)||{day,event:r.event,version:r.version,os:r.os,host:r.host,count:0};row.count++;groups.set(key,row);}
  return {totals,rows:[...groups.values()].sort((a,b)=>b.day.localeCompare(a.day)),verificationReceipts:rows.length-live.length,
    definition:'按服务器收到回执的中国日期汇总；自愿参加的安装实例，不等于人数。旧安装首次参加、升级与新安装分别统计。首次使用为宿主确认完成实际任务，非用户满意度。'};
}
