import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {mutateState,readState} from '../skills/bab/scripts/store.mjs';
import {metricsConsent,flushMetrics,markFirstUse} from '../skills/bab/scripts/metrics.mjs';
import {receiveMetrics,metricsSummary} from '../server/metrics.mjs';
async function fixture(t,existing=false){const home=await fs.mkdtemp(path.join(os.tmpdir(),'bab-metrics-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));const dir=path.join(home,'skills');await mutateState(home,s=>{s.installations=[{skillsDir:dir,version:'0.1.20',metricsEligibleNew:!existing}];});return {home,dir};}
function transport(home,calls){return async(_,opts)=>{const payload=JSON.parse(opts.body);calls.push(payload);return {ok:true,json:()=>receiveMetrics(home,payload)};};}
test('consent, unique receipts, first-use gate and withdrawal',async t=>{const {home,dir}=await fixture(t),server=path.join(home,'server'),calls=[],options={endpoint:'https://example.com/metrics',fetcher:transport(server,calls)};
 assert.equal((await flushMetrics(home,dir,options)).status,'disabled');assert.equal(calls.length,0);
 await assert.rejects(metricsConsent(home,{skillsDir:dir,enabled:true},options),/明确同意/);
 await metricsConsent(home,{skillsDir:dir,enabled:true,userApproved:true,host:'codex'},options);assert.equal(calls[0].event,'install_success');assert.equal(JSON.stringify(calls).includes(home),false);
 await flushMetrics(home,dir,options);assert.equal(calls.length,1);await assert.rejects(markFirstUse(home,dir,options),/实际任务/);
 await markFirstUse(home,dir,{...options,confirmed:true});await markFirstUse(home,dir,{...options,confirmed:true});assert.equal(calls.length,2);
 await mutateState(home,s=>s.installations[0].version='0.1.21');await flushMetrics(home,dir,options);assert.equal(calls.at(-1).event,'update_success');
 await metricsConsent(home,{skillsDir:dir,enabled:false},options);await flushMetrics(home,dir,options);assert.equal(calls.length,3);
 const summary=await metricsSummary(server);assert.deepEqual(summary.totals,{install_success:1,existing_install_observed:0,update_success:1,first_use_success:1});
});
test('existing installs, retry deduplication and test isolation',async t=>{const {home,dir}=await fixture(t,true),server=path.join(home,'server'),calls=[];let fail=true;
 const options={endpoint:'https://example.com/metrics',test:true,fetcher:async(_,opts)=>{const p=JSON.parse(opts.body);calls.push(p);const result=await receiveMetrics(server,p);if(fail){fail=false;throw Error('response lost');}return {ok:true,json:async()=>result};}};
 const first=await metricsConsent(home,{skillsDir:dir,enabled:true,userApproved:true},options);assert.equal(first.receipt.status,'pending');await flushMetrics(home,dir,options);assert.equal(calls.length,2);assert.equal(calls[0].id,calls[1].id);assert.equal(calls[0].event,'existing_install_observed');
 const result=await metricsSummary(server);assert.equal(result.verificationReceipts,1);assert.equal(result.totals.existing_install_observed,0);
 await assert.rejects(receiveMetrics(server,{...calls[0],version:'0.1.99'}),/id-conflict/);await assert.rejects(receiveMetrics(server,{...calls[0],path:'/private'}),/invalid-receipt/);
});
test('semantic dedup covers repeated client identities and parallel sends',async t=>{const {home}=await fixture(t);const p={schema:1,id:randomUUID(),installationId:randomUUID(),event:'install_success',version:'0.1.20',os:'linux',host:'other',occurredAt:new Date().toISOString()};
 await Promise.all([receiveMetrics(home,p),receiveMetrics(home,p)]);await receiveMetrics(home,{...p,id:randomUUID()});assert.equal((await metricsSummary(home)).totals.install_success,1);
});

test('HTTP receiver and private summary require the correct permissions',async t=>{
 const {home}=await fixture(t),{consoleServer,passwordHash}=await import('../server/console.mjs');
 const server=consoleServer({home:path.join(home,'inbox'),adminToken:'test-admin-token-32-characters-long-secret',loginHash:passwordHash('test-password'),origin:'https://example.com',html:path.join(home,'none.html'),versions:async()=>['0.1.20'],analyticsHome:path.join(home,'analytics'),logSummary:path.join(home,'missing.json')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(base+'/admin/analytics')).status,401);
 const payload={schema:1,id:randomUUID(),installationId:randomUUID(),event:'install_success',version:'0.1.20',os:'linux',host:'other',occurredAt:new Date().toISOString(),test:true};
 const options={method:'POST',headers:{'content-type':'application/json','idempotency-key':payload.id},body:JSON.stringify(payload)};
 assert.equal((await fetch(base+'/v1/metrics',options)).status,200);assert.equal((await fetch(base+'/v1/metrics',options)).status,200);
 const summary=await (await fetch(base+'/admin/analytics',{headers:{authorization:'Bearer test-admin-token-32-characters-long-secret'}})).json();assert.equal(summary.metrics.verificationReceipts,1);assert.equal(summary.metrics.totals.install_success,0);assert.equal(summary.logs,null);
});

test('installer waits for transient filesystem handles without forcing replacement',async t=>{
 const {renameForInstall}=await import('../skills/bab/scripts/install.mjs');const {home}=await fixture(t),from=path.join(home,'source'),to=path.join(home,'destination');await fs.mkdir(from);await fs.writeFile(path.join(from,'keep.txt'),'preserved');
 const rename=fs.rename;let attempts=0;const mock=t.mock.method(fs,'rename',async(a,b)=>{if(attempts++===0)throw Object.assign(Error('scanner lock'),{code:'EPERM'});return rename(a,b);});
 await renameForInstall(from,to);assert.equal(attempts,2);assert.equal(await fs.readFile(path.join(to,'keep.txt'),'utf8'),'preserved');mock.mock.restore();
 await assert.rejects(renameForInstall(from,to),{code:'ENOENT'});
});
