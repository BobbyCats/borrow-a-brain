import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createProfile, saveProfileVersion, activateProfile, getProfile, exportProfile} from '../skills/bab/scripts/profiles.mjs';
import {saveRoute, loadRoute, listRoutes, checkpointRoute} from '../skills/bab/scripts/routing.mjs';
import {grantHistory, readHistory} from '../skills/bab/scripts/history.mjs';
import {addRule, queryRules} from '../skills/bab/scripts/memory.mjs';
import {clearDerivedData, mutateState, readState} from '../skills/bab/scripts/store.mjs';

async function sandbox(t) {const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bab-evidence-')); t.after(() => fs.rm(home, {recursive:true, force:true})); return home;}
const input = name => ({name, kind:'method', purpose:'合成资料中的取舍方法', userApproved:true});
const material = {kind:'meeting',title:'合成会议',extraction:'subtitles',coverage:'partial',locator:'00:30–00:45，A',inspected:'字幕 00:00–02:00',omitted:'原音与画面',uncertainty:'字幕未对原音',identity:'用户明确说 A 是自己',origin:'synthetic-meeting-1'};
const version = () => ({change:'合成测试',boundaries:'仅限测试',sources:[{id:'s1',role:'subject',ref:'synthetic://meeting/1#00:30',date:'未知',excerpt:'先完成必须交付的部分',material}],methods:[{name:'先满足交付',trigger:'时间不足',action:'先区分必须交付和可延后部分',reason:'控制准备量',limits:'不能舍弃硬性要求',evidence:'observed',sourceIds:['s1']}],evaluations:[{kind:'new',input:'私人测试问题，不应自动分享',output:'私人测试回答',result:'pass',reviewer:'synthetic fixture'},{kind:'boundary',input:'没有交付要求',output:'不适用',result:'pass',reviewer:'synthetic fixture'}]});
async function active(home,name) {const p=await createProfile(home,input(name));const v=await saveProfileVersion(home,p.id,version());await activateProfile(home,p.id,v.version,v.approvalHash);return p;}

test('排除名单跨轮和改目标仍保留，显式授权才解除，且只在当前任务有效', async t=>{
 const home=await sandbox(t), a=await active(home,'甲'),b=await active(home,'乙');
 const choice=id=>({id,role:'lead',responsibility:'取舍',why:'当前材料适用'});
 const plan={taskId:'t1',intent:'原目标',deliverable:'一份结果',selected:[choice(b.id)],excludedIds:[a.id]};
 await saveRoute(home,plan);await checkpointRoute(home,'t1',{status:'active',summary:'已有草稿',next:'调整'});
 assert.deepEqual((await listRoutes(home))[0].excludedIds,[a.id]);
 const changed={...plan,intent:'新目标'};delete changed.excludedIds;
 assert.deepEqual((await saveRoute(home,changed)).excludedIds,[a.id]);
 assert.equal((await loadRoute(home,'t1')).status,'needs-review');
 await assert.rejects(saveRoute(home,{...changed,selected:[choice(a.id)],excludedIds:[]}),/排除/u);
 await assert.rejects(saveRoute(home,{...changed,selected:[choice(a.id)],releaseExcludedIds:[a.id]}),/明确同意/u);
 await saveRoute(home,{...changed,selected:[choice(a.id)],releaseExcludedIds:[a.id],userApprovedExclusionChange:true});
 assert.deepEqual((await loadRoute(home,'t1')).plan.excludedIds,[]);
 await saveRoute(home,{...changed,taskId:'new-task',selected:[choice(a.id)]});
});

test('多媒体证据经版本与记忆保存可回读；未读取材料不能充当证据', async t=>{
 const home=await sandbox(t),p=await active(home,'多媒体方法');
 assert.deepEqual((await getProfile(home,p.id)).record.sources[0].material,material);
 const rule={kind:'method',status:'confirmed',userConfirmed:true,statement:'先满足交付',conditions:'时间不足',sources:[{role:'user',ref:'synthetic://meeting#00:30',excerpt:'先完成必须交付的部分',material}]};
 await addRule(home,rule);assert.deepEqual((await queryRules(home,'交付'))[0].sources[0].material,material);
 const bad=version();bad.sources[0].material={...material,coverage:'unavailable'};
 await assert.rejects(saveProfileVersion(home,p.id,bad),/未读取/u);
 await assert.rejects(addRule(home,{...rule,sources:[{...rule.sources[0],material:{...material,coverage:'unavailable'}}]}),/未读取/u);
 const missing=version();missing.sources[0].material={...material,locator:''};await assert.rejects(saveProfileVersion(home,p.id,missing),/locator/u);
});

test('旧文字档案和记忆保持可读，新增回执不强迫数据迁移', async t=>{
 const home=await sandbox(t),p=await createProfile(home,input('旧资料'));const old=version();delete old.sources[0].material;
 const v=await saveProfileVersion(home,p.id,old);await activateProfile(home,p.id,v.version,v.approvalHash);
 const loaded=await getProfile(home,p.id);assert.equal(loaded.record.sources[0].material,undefined);
 assert.ok(loaded.skill.includes('先区分必须交付'));
 await addRule(home,{kind:'observation',statement:'旧观察',conditions:'一次',sources:[{role:'user',ref:'synthetic://old',excerpt:'旧原话'}]});
});

test('独立导出有完整编号映射和试用边界，私人记录默认不外带；审阅摘要改变则旧确认失效',async t=>{
 const home=await sandbox(t),p=await active(home,'方法');const input={destination:path.join(home,'export'),skillName:'test-evidence',displayName:'方法'};
 const preview=await exportProfile(home,p.id,input);
 assert.match(preview.content,/s1：来源未分享/u);assert.match(preview.content,/新问题试用：pass/u);
 assert.ok(!preview.content.includes('私人测试'));assert.ok(!preview.content.includes('synthetic://meeting'));
 const shared={...input,sourceSummaries:[{id:'s1',summary:'虚构会议，00:30–00:45；仅字幕',url:'https://example.org/source'}],evaluationSummaries:[{kind:'new',input:'半小时准备分享',output:'先做必须交付的三点',reviewer:'AI 自评'}]};
 const changed=await exportProfile(home,p.id,{...shared,approvalHash:preview.approvalHash});assert.equal(changed.status,'preview');
 assert.match(changed.content,/00:30–00:45/u);assert.match(changed.content,/AI 自评/u);await assert.rejects(fs.stat(input.destination));
 await exportProfile(home,p.id,{...shared,approvalHash:changed.approvalHash});
 assert.equal(await fs.readFile(path.join(input.destination,'SKILL.md'),'utf8'),changed.content);
 await assert.rejects(exportProfile(home,p.id,{...shared,sourceSummaries:[{id:'missing',summary:'不存在'}]}),/不存在/u);
});

test('历史排除原因有计数，目录不是会话总数，达到读取限额不称完整',async t=>{
 const home=await sandbox(t),root=path.join(home,'history');await fs.mkdir(root);
 const raw=id=>JSON.stringify({messages:[{role:'user',content:id}],id});
 await fs.mkdir(path.join(root,'subagents'));await fs.mkdir(path.join(root,'archived_sessions'));
 await fs.writeFile(path.join(root,'archived_sessions','hidden.json'),raw('hidden'));
 await fs.writeFile(path.join(root,'child.json'),JSON.stringify({child:true,messages:[{role:'user',content:'child'}]}));
 const grant=await grantHistory(home,{root,adapter:'export',purpose:'合成测试',userApproved:true});
 const excluded=await readHistory(home,grant.id);assert.equal(excluded.returned,0);assert.equal(excluded.completeness,'partial');
 assert.deepEqual(excluded.excluded,{'archived-directory':1,'subagent-directory':1,'subagent-session':1});
 if(process.platform!=='win32'){await fs.symlink(path.join(root,'child.json'),path.join(root,'link.json'));assert.equal((await readHistory(home,grant.id)).excluded['symbolic-link'],1);}
 await fs.writeFile(path.join(root,'one.json'),raw('one'));await fs.writeFile(path.join(root,'two.json'),raw('two'));
 const bounded=await readHistory(home,grant.id,{limit:1});assert.equal(bounded.returned,1);assert.ok(bounded.uninspectedCandidates>0);assert.equal(bounded.completeness,'partial');
});

test('清空与新档案创建共享一把锁，提交前旧数据清除，提交后新数据有明确语义',async t=>{
 const home=await sandbox(t);const old=await active(home,'旧档案');await mutateState(home,s=>{s.installations=[{id:'keep'}];});
 const rename=fs.rename;let entered,release;const started=new Promise(r=>{entered=r;});const gate=new Promise(r=>{release=r;});
 t.mock.method(fs,'rename',async(from,to)=>{if(from===path.join(home,'people')){entered();await gate;}return rename(from,to);});
 const clearing=clearDerivedData(home);await started;let created=false;
 const writing=createProfile(home,input('提交后新档案')).then(v=>{created=true;return v;});
 await new Promise(r=>setImmediate(r));assert.equal(created,false);
 release();const [receipt,fresh]=await Promise.all([clearing,writing]);
 assert.equal(receipt.semantics,'atomic-reset');assert.equal(receipt.removedProfiles,1);
 assert.match(receipt.scope,/提交后/u);const state=await readState(home);
 assert.deepEqual(state.profiles.map(p=>p.id),[fresh.id]);assert.equal(state.installations[0].id,'keep');
 await assert.rejects(fs.stat(path.join(home,'people',old.id)));
 assert.ok(!(await fs.readdir(home)).some(n=>n.startsWith('.clear-')));
});

test('同类型多条测试摘要必须精确对应，不能把已跑题目贴到未跑记录上',async t=>{
 const home=await sandbox(t),p=await createProfile(home,input('多条试用'));const record=version();record.evaluations.push({kind:'new',input:'未跑第二题',output:'尚未执行',result:'unrun',reviewer:'fixture'});
 const v=await saveProfileVersion(home,p.id,record);await activateProfile(home,p.id,v.version,v.approvalHash);
 const arg={destination:path.join(home,'share'),skillName:'many-tests',displayName:'多测试',evaluationSummaries:[{kind:'new',input:'第一题',output:'已跑输出',reviewer:'AI 自评'}]};
 await assert.rejects(exportProfile(home,p.id,arg),/歧义/u);
 const preview=await exportProfile(home,p.id,{...arg,evaluationSummaries:[{...arg.evaluationSummaries[0],index:0}]});
 assert.equal(preview.content.split('已跑输出').length-1,1);assert.match(preview.content,/新问题试用：unrun；原题/u);
});

test('矛盾读取回执被拒绝，不能以 unavailable 读取方式冒充已读',async t=>{
 const home=await sandbox(t),p=await createProfile(home,input('矛盾回执'));const bad=version();bad.sources[0].material={...material,extraction:'unavailable',coverage:'full'};
 await assert.rejects(saveProfileVersion(home,p.id,bad),/未能读取/u);
});

test('清理失败后可重试已登记旧目录，不能第二次假报已彻底清除',async t=>{
 const home=await sandbox(t);await active(home,'待清理资料');const rm=fs.rm;let failed=false;
 const mock=t.mock.method(fs,'rm',async(file,options)=>{if(path.basename(file).startsWith('.clear-')&&!failed){failed=true;throw new Error('synthetic permission failure');}return rm(file,options);});
 await assert.rejects(clearDerivedData(home),/清理未完成/u);
 const pending=(await readState(home)).maintenance.pendingClear;assert.equal(pending.length,1);await fs.stat(path.join(home,pending[0]));
 mock.mock.restore();assert.equal((await clearDerivedData(home)).cleared,true);
 assert.deepEqual((await readState(home)).maintenance.pendingClear,[]);await assert.rejects(fs.stat(path.join(home,pending[0])));
});

test('清空状态提交后解锁失败，不得恢复已删除索引对应的旧文件',async t=>{
 const home=await sandbox(t);await active(home,'旧资料');const rm=fs.rm;let failed=false;
 const mock=t.mock.method(fs,'rm',async(file,options)=>{if(path.basename(file)==='write.lock'&&!failed){failed=true;throw new Error('synthetic unlock failure');}return rm(file,options);});
 await assert.rejects(clearDerivedData(home),/清理未完成/u);assert.deepEqual((await readState(home)).profiles,[]);await assert.rejects(fs.stat(path.join(home,'people')));
 mock.mock.restore();await fs.rm(path.join(home,'write.lock'));assert.equal((await clearDerivedData(home)).cleared,true);
});

test('人物删除失败残留有登记，单项重试和全部清除不会遗留私密摘录',async t=>{
 const {deleteProfile}=await import('../skills/bab/scripts/profiles.mjs');
 for(const retry of ['profile','all']){
  const home=await sandbox(t),p=await active(home,'待删档案');const rm=fs.rm;let failed=false;
  const mock=t.mock.method(fs,'rm',async(file,options)=>{if(path.basename(file).startsWith('.delete-')&&!failed){failed=true;throw new Error('synthetic delete failure');}return rm(file,options);});
  await assert.rejects(deleteProfile(home,p.id),/synthetic/u);const pending=(await readState(home)).maintenance.pendingClear;assert.equal(pending.length,1);await fs.stat(path.join(home,pending[0]));mock.mock.restore();
  if(retry==='profile')await deleteProfile(home,p.id);else await clearDerivedData(home);
  await assert.rejects(fs.stat(path.join(home,pending[0])));assert.deepEqual((await readState(home)).maintenance.pendingClear,[]);
 }
});
