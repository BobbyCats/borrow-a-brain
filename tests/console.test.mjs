import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {consoleServer,passwordHash} from '../server/console.mjs';
import {readState} from '../skills/bab/scripts/store.mjs';
test('private console: sessions, consented receipt, authorization, version validation and durable updates',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'bab-console-'));const html=path.join(home,'login.html');await fs.writeFile(html,'<h1>登录</h1>');let base;
 const server=consoleServer({home,adminToken:'a'.repeat(40),loginHash:passwordHash('test-only-password'),origin:'http://localhost',html,secure:false,versions:async()=>['0.1.1']});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 const call=(p,method='GET',data,headers={})=>fetch(base+p,{method,headers:{'content-type':'application/json',...headers},body:data?JSON.stringify(data):undefined});
 try{
  assert.equal((await call('/admin/feedback')).status,401);
  assert.equal((await call('/session','POST',{password:'test-only-password'},{origin:'http://evil.test'})).status,403);
  assert.equal((await call('/session','POST',{password:'wrong'},{origin:'http://localhost'})).status,401);
  const login=await call('/session','POST',{password:'test-only-password'},{origin:'http://localhost'});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],session=await login.json();const headers={cookie,origin:'http://localhost','x-csrf-token':session.csrf};
  const report={id:randomUUID(),version:'0.1.0',skill:'bab-help',goal:'合成测试：安装后使用',expected:'进入第一次使用',actual:'缺少中文安装说明',steps:'合成环境安装后打开帮助',observed:'找不到官网上手页',hypothesis:'待验证：缺少使用入口',suggestion:'接入工具说明页',environment:{agent:'synthetic-host',os:'synthetic-os'}};
  const sent=await call('/v1/feedback','POST',report,{'idempotency-key':report.id});assert.equal(sent.status,201);const receipt=await sent.json();const twice=await call('/v1/feedback','POST',report,{'idempotency-key':report.id});assert.deepEqual(await twice.json(),receipt);
  const inbox=await(await call('/admin/feedback','GET',null,headers)).json();assert.equal(inbox.items.length,1);assert.equal(inbox.items[0].token,undefined);
  assert.equal((await call('/v1/feedback/'+report.id)).status,404);assert.equal((await call('/v1/feedback/'+report.id,'GET',null,{authorization:'Bearer not-this-report'})).status,404);
  assert.equal((await call('/admin/feedback/'+report.id,'PATCH',{status:'working',revision:0},{cookie,origin:'http://localhost'})).status,403);
  assert.equal((await call('/admin/feedback/'+report.id,'PATCH',{status:'resolved',revision:0,fixedIn:'9.9.9'},headers)).status,400);
  const update=await call('/admin/feedback/'+report.id,'PATCH',{status:'resolved',revision:0,fixedIn:'0.1.1',reply:'中文说明已发布，请更新后再试。',note:'仅作者的内部记录'},headers);assert.equal(update.status,200);
  const read=await(await call('/v1/feedback/'+report.id,'GET',null,{authorization:'Bearer '+receipt.token})).json();assert.equal(read.fixedIn,'0.1.1');assert.equal(read.message,'中文说明已发布，请更新后再试。');assert.equal(read.note,undefined);
  assert.equal((await call('/admin/feedback/'+report.id,'PATCH',{status:'working',revision:0},headers)).status,409);
  const saved=await readState(home);assert.equal(saved.inbox.length,1);assert.equal(saved.inbox[0].audit.length,1);assert.equal(saved.inbox[0].note,'仅作者的内部记录');
  await call('/session','DELETE',null,headers);assert.equal((await call('/admin/feedback','GET',null,headers)).status,401);
 }finally{await new Promise(r=>server.close(r));await fs.rm(home,{recursive:true,force:true});}
});
