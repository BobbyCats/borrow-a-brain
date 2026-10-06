import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {importMaterial,listMaterials,getMaterial,deleteMaterial,cleanupMaterials} from '../skills/bab/scripts/materials.mjs';
import {createProfile,saveProfileVersion,activateProfile,getProfile,resolveProfile,exportProfile} from '../skills/bab/scripts/profiles.mjs';
import {saveRoute,loadRoute,routingCatalog} from '../skills/bab/scripts/routing.mjs';
import {addRule,queryRules,listRules} from '../skills/bab/scripts/memory.mjs';
import {readState,clearDerivedData} from '../skills/bab/scripts/store.mjs';
async function sandbox(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'bab-material-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,home:path.join(root,'data')};}
async function put(home,source,extra={}){const input={source,title:'虚构 会议／纪要',kind:'meeting',tags:['协作'],...extra};const preview=await importMaterial(home,input);return importMaterial(home,{...input,apply:true,approvalHash:preview.approvalHash});}
async function file(root,name,content){const f=path.join(root,name);await fs.writeFile(f,content);return f;}
const receipt=(library)=>({kind:'meeting',title:'合成会议',extraction:'text',coverage:'full',locator:'段落 1',inspected:'全文',omitted:'无',uncertainty:'一次样本',identity:'A 是用户',origin:'meeting-1',library});
async function dependents(home,library){const p=await createProfile(home,{name:'合成方法',kind:'method',purpose:'优先交付',userApproved:true});const record={change:'首次',boundaries:'一次观察',sources:[{id:'s1',role:'user',ref:'material:'+library.id,excerpt:'先交付',date:'未知',material:receipt(library)}],methods:[{name:'先交付',trigger:'时间不足',action:'先交付必须完成部分',reason:'兑现约定',limits:'硬要求不能删',evidence:'observed',sourceIds:['s1']}],evaluations:['new','boundary'].map(kind=>({kind,input:'合成测试',output:'预设测试状态',result:'pass',reviewer:'fixture'}))};const v=await saveProfileVersion(home,p.id,record);await activateProfile(home,p.id,v.version,v.approvalHash);await saveRoute(home,{taskId:'reuse',intent:'复用',deliverable:'草稿',selected:[{id:p.id,role:'lead',responsibility:'取舍',why:'适用'}]});const rule=await addRule(home,{kind:'method',statement:'先交付',conditions:'时间不足',status:'confirmed',userConfirmed:true,sources:[{role:'user',ref:'material:'+library.id,excerpt:'先交付',material:receipt(library)}]});return{p,v,record,rule};}

test('预览不复制；确认摘要后导入规范文件，同范围去重并保留多个来源身份',async t=>{
 const {root,home}=await sandbox(t),source=await file(root,'原始纪要.txt','fictional contents');const input={source,title:'会议：一号',kind:'meeting',scope:'project:A',sourceRef:'user-provided-A'};
 const preview=await importMaterial(home,input);assert.equal(preview.status,'preview');await assert.rejects(fs.stat(home));
 await assert.rejects(importMaterial(home,{...input,apply:true,approvalHash:'wrong'}),/预览/u);
 const imported=await importMaterial(home,{...input,apply:true,approvalHash:preview.approvalHash});assert.match(imported.path,/__r0001\.txt$/u);assert.equal(await fs.readFile(imported.path,'utf8'),'fictional contents');assert.equal(await fs.readFile(source,'utf8'),'fictional contents');
 const duplicate=await put(home,source,{title:'另一标题',scope:'project:A',sourceRef:'user-provided-B'});assert.equal(duplicate.status,'reused');assert.equal(duplicate.material.id,imported.material.id);assert.equal(duplicate.material.provenance.length,2);
 assert.equal((await listMaterials(home)).length,0);assert.equal((await listMaterials(home,{scope:'project:A',query:'另一标题'})).length,1);
 const other=await put(home,source,{scope:'project:B'});assert.notEqual(other.material.id,imported.material.id);await assert.rejects(getMaterial(home,imported.material.id,'project:B'),/范围/u);
});

test('替换只留当前副本，旧证据冻结并退出方法路由和记忆默认检索，补读确认后恢复',async t=>{
 const {root,home}=await sandbox(t),source=await file(root,'record.txt','version 1');const first=await put(home,source);const current=await getMaterial(home,first.material.id);const d=await dependents(home,current.library);const frozen=await fs.readFile(path.join(d.v.path,'record.json'),'utf8');
 const newer=await file(root,'new.txt','version 2');const preview=await importMaterial(home,{source:newer,title:'更新纪要',kind:'meeting',id:current.id});assert.deepEqual(preview.affected.profiles,[d.p.id]);
 const updated=await importMaterial(home,{source:newer,title:'更新纪要',kind:'meeting',id:current.id,apply:true,approvalHash:preview.approvalHash});assert.equal(updated.material.revision,2);await assert.rejects(fs.stat(first.path));assert.equal(await fs.readFile(source,'utf8'),'version 1');
 assert.equal(await fs.readFile(path.join(d.v.path,'record.json'),'utf8'),frozen);assert.equal((await getProfile(home,d.p.id)).sourceStatus,'needs-review');assert.equal((await resolveProfile(home,'合成方法')).status,'needs-review');assert.equal((await routingCatalog(home)).length,0);assert.equal((await loadRoute(home,'reuse')).status,'needs-review');assert.equal((await queryRules(home,'交付')).length,0);assert.equal((await listRules(home))[0].sourceChanges[0].status,'source-updated');
 await assert.rejects(getMaterial(home,current.id,'personal',1),/旧版本/u);await assert.rejects(activateProfile(home,d.p.id,d.v.version,d.v.approvalHash),/来源/u);await assert.rejects(exportProfile(home,d.p.id,{skillName:'test-material',displayName:'方法',destination:path.join(root,'export')}),/来源/u);
 const newSource=await getMaterial(home,current.id);d.record.sources[0].material.library=newSource.library;const v2=await saveProfileVersion(home,d.p.id,d.record);await activateProfile(home,d.p.id,v2.version,v2.approvalHash);assert.equal((await routingCatalog(home)).length,1);
});

test('原文件、预览版本、源字节变化与容量限额均受保护',async t=>{
 const {root,home}=await sandbox(t),source=await file(root,'source.txt','first');const args={source,title:'source',kind:'text'};const preview=await importMaterial(home,args);await fs.writeFile(source,'changed');await assert.rejects(importMaterial(home,{...args,apply:true,approvalHash:preview.approvalHash}),/已变化/u);
 await assert.rejects(importMaterial(home,{...args,maxBytes:1}),/容量/u);
 const imported=await put(home,source);const second=await file(root,'second.txt','second');const update={...args,source:second,id:imported.material.id};const oldPreview=await importMaterial(home,update);await put(home,second,{id:imported.material.id});await assert.rejects(importMaterial(home,{...update,apply:true,approvalHash:oldPreview.approvalHash}),/已变化/u);
 const library=await getMaterial(home,imported.material.id);await fs.writeFile(library.path,'manual edit');await assert.rejects(getMaterial(home,library.id),/直接修改/u);
});

test('删除预览说明派生边界，删除后来源缺失；清空也清素材与必要摘录',async t=>{
 const {root,home}=await sandbox(t),source=await file(root,'one.txt','private synthetic');const m=await put(home,source),got=await getMaterial(home,m.material.id);const d=await dependents(home,got.library);
 const preview=await deleteMaterial(home,got.id);assert.match(preview.note,/必要摘录保留/u);assert.equal(await fs.readFile(got.path,'utf8'),'private synthetic');
 await deleteMaterial(home,got.id,{apply:true,approvalHash:preview.approvalHash});assert.equal((await getProfile(home,d.p.id)).sourceChanges[0].status,'source-missing');assert.equal((await queryRules(home,'交付')).length,0);assert.equal(await fs.readFile(source,'utf8'),'private synthetic');
 await put(home,source);await clearDerivedData(home);assert.equal((await listMaterials(home)).length,0);await assert.rejects(fs.stat(path.join(home,'materials')));assert.deepEqual((await readState(home)).profiles,[]);assert.equal(await fs.readFile(source,'utf8'),'private synthetic');
});

test('素材副本目录不跟随符号链接，源目录和链接文件拒绝导入',async t=>{
 if(process.platform==='win32')return t.skip('Windows 管理员符号链接权限另测');
 const {root,home}=await sandbox(t),source=await file(root,'one.txt','x');await assert.rejects(importMaterial(home,{source:root,title:'目录',kind:'text'}),/普通文件/u);const link=path.join(root,'link.txt');await fs.symlink(source,link);await assert.rejects(importMaterial(home,{source:link,title:'链接',kind:'text'}),/普通文件/u);
 const outside=path.join(root,'outside');await fs.mkdir(outside);await fs.mkdir(home);await fs.symlink(outside,path.join(home,'materials'));await assert.rejects(put(home,source),/链接/u);assert.deepEqual(await fs.readdir(outside),[]);
});

test('旧副本清理失败有回执且可重试，不把残留文件说成删除成功',async t=>{
 const {root,home}=await sandbox(t),source=await file(root,'one.txt','one'),m=await put(home,source);const newer=await file(root,'two.txt','two');const rm=fs.rm;let failed=false;
 const mock=t.mock.method(fs,'rm',async(file,options)=>{if(path.basename(file).startsWith('.material-backup-')&&!failed){failed=true;throw new Error('synthetic cleanup failure');}return rm(file,options);});
 await assert.rejects(put(home,newer,{id:m.material.id}),/清理未完成/u);assert.equal((await getMaterial(home,m.material.id)).revision,2);const pending=(await readState(home)).maintenance.pendingMaterials;assert.equal(pending.length,1);
 mock.mock.restore();await cleanupMaterials(home);await assert.rejects(fs.stat(path.join(home,pending[0])));assert.deepEqual((await readState(home)).maintenance.pendingMaterials,[]);
});

test('去重暂存清理失败会登记，cleanup 和 data-clear 都能清除而不遗漏整份副本',async t=>{
 const {root,home}=await sandbox(t),source=await file(root,'private.txt','synthetic private material');await put(home,source);const rm=fs.rm;let failed=false;
 const mock=t.mock.method(fs,'rm',async(file,options)=>{if(path.basename(file).startsWith('.material-stage-')&&!failed){failed=true;throw new Error('synthetic stage failure');}return rm(file,options);});
 await assert.rejects(put(home,source),/暂存清理未完成/u);const stages=(await readState(home)).maintenance.materialStages;assert.equal(stages.length,1);assert.equal(stages[0].status,'cleanup');assert.equal(await fs.readFile(path.join(home,stages[0].name,'source'),'utf8'),'synthetic private material');
 mock.mock.restore();await cleanupMaterials(home);await assert.rejects(fs.stat(path.join(home,stages[0].name)));assert.deepEqual((await readState(home)).maintenance.materialStages,[]);
 const saved=await put(home,source);await clearDerivedData(home);assert.deepEqual((await readState(home)).materials,[]);assert.ok(!(await fs.readdir(home)).some(n=>n.startsWith('.material-stage-')));
});

test('相同字节与泛化来源描述不会吞掉不同文件和内容日期',async t=>{
 const {root,home}=await sandbox(t),a=await file(root,'event-a.txt','same'),b=await file(root,'event-b.txt','same');await put(home,a,{sourceRef:'用户提供',contentDate:'2026-01-01'});const reused=await put(home,b,{sourceRef:'用户提供',contentDate:'2026-02-01'});
 assert.equal((await listMaterials(home,{query:'event-b.txt'})).length,1);assert.equal(reused.material.provenance.length,2);assert.deepEqual(reused.material.provenance.map(x=>x.contentDate),['2026-01-01','2026-02-01']);assert.equal((await put(home,b,{sourceRef:'用户提供',contentDate:'2026-02-01'})).material.provenance.length,2);
});

test('进程在移动旧副本后直接退出，确认旧进程结束后恢复原版本并清掉暂存',async t=>{
 const {spawnSync}=await import('node:child_process');
 const {root,home}=await sandbox(t),source=await file(root,'one.txt','version one'),m=await put(home,source),newer=await file(root,'two.txt','version two');
 const moduleURL=new URL('../skills/bab/scripts/materials.mjs',import.meta.url).href;
 const script=`import fs from 'node:fs/promises';import path from 'node:path';import {importMaterial} from ${JSON.stringify(moduleURL)};const [home,source,id]=process.argv.slice(1);const input={source,id,title:'updated',kind:'meeting'};const preview=await importMaterial(home,input);const rename=fs.rename;fs.rename=async(from,to)=>{await rename(from,to);if(path.basename(to).startsWith('.material-backup-'))process.exit(77);};await importMaterial(home,{...input,apply:true,approvalHash:preview.approvalHash});`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script,home,newer,m.material.id],{encoding:'utf8'});assert.equal(result.status,77,result.stderr);
 assert.equal(JSON.parse(await fs.readFile(path.join(home,'write.lock'),'utf8')).pid,result.pid);
 // The child has definitively exited; never do this based on lock age in production.
 await fs.rm(path.join(home,'write.lock'));await cleanupMaterials(home);
 const restored=await getMaterial(home,m.material.id);assert.equal(restored.revision,1);assert.equal(await fs.readFile(restored.path,'utf8'),'version one');assert.ok(!(await fs.readdir(home)).some(n=>n.startsWith('.material-backup-')||n.startsWith('.material-stage-')||n==='file-transaction.json'));
});

test('data-clear 包含登记的失败素材暂存，不留下未索引的完整副本',async t=>{
 const {root,home}=await sandbox(t),source=await file(root,'one.txt','synthetic private');await put(home,source);const rm=fs.rm;let failed=false;
 const mock=t.mock.method(fs,'rm',async(file,options)=>{if(path.basename(file).startsWith('.material-stage-')&&!failed){failed=true;throw new Error('synthetic stage failure');}return rm(file,options);});
 await assert.rejects(put(home,source),/暂存/u);const name=(await readState(home)).maintenance.materialStages[0].name;mock.mock.restore();await clearDerivedData(home);await assert.rejects(fs.stat(path.join(home,name)));assert.equal(await fs.readFile(source,'utf8'),'synthetic private');
});
