import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {passwordHash} from '../server/console.mjs';
test('软链接发布目录可启动服务与执行每日维护',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bab-deploy-'));
 let child;
 try{
  await fs.symlink(path.resolve('.'),path.join(root,'current'),process.platform==='win32'?'junction':'dir');
  await fs.writeFile(path.join(root,'releases.json'),JSON.stringify({versions:['0.1.1']}));
  await fs.writeFile(path.join(root,'admin.html'),'<h1>synthetic</h1>');
  const env={...process.env,BAB_INBOX_HOME:path.join(root,'data'),BAB_ADMIN_TOKEN:'synthetic-token'.repeat(4),BAB_LOGIN_HASH:passwordHash('synthetic-password'),BAB_ORIGIN:'https://example.test',BAB_ADMIN_HTML:path.join(root,'admin.html'),BAB_RELEASES_FILE:path.join(root,'releases.json'),PORT:'0'};
  child=spawn(process.execPath,[path.join(root,'current/server/console.mjs')],{env,stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',data=>{stderr+=data;});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('service startup timed out')),5000);child.stdout.on('data',data=>{if(data.toString().includes('ready')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(Error('service exited before listening: '+code+' '+stderr));});});
  assert.equal(child.exitCode,null);
  const result=spawnSync(process.execPath,[path.join(root,'current/server/maintenance.mjs')],{env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).purged,0);
  assert.ok((await fs.readdir(path.join(root,'data/backups'))).length);
 }finally{if(child&&child.exitCode===null){await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}await fs.rm(root,{recursive:true,force:true});}
});
