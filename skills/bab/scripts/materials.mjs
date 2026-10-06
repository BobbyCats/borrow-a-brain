import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {boundedString, isWithin, mutateState, readState} from './store.mjs';
import {materialKinds} from './evidence.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const visible = (row, scope) => row.scope === 'personal' || row.scope === scope;
async function shaFile(file, maxBytes = Number.MAX_SAFE_INTEGER) {const hash=createHash('sha256');let bytes=0;for await (const chunk of createReadStream(file)) {bytes+=chunk.length;if(bytes>maxBytes)throw new Error('素材超过本次容量上限，未导入。');hash.update(chunk);}return hash.digest('hex');}
async function libraryDirectory(home, directory) {
  const relative=path.relative(path.resolve(home),path.resolve(directory));
  if(!isWithin(path.resolve(home,'materials'),path.resolve(directory)))throw new Error('素材目录越界。');
  let current=home;
  for(const segment of relative.split(path.sep)){current=path.join(current,segment);let stat;try{stat=await fs.lstat(current);}catch(e){if(e.code!=='ENOENT')throw e;await fs.mkdir(current,{mode:0o700});stat=await fs.lstat(current);}
    if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('素材目录不能通过链接重定向。');
  }
}
function safeTitle(title) {return title.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/gu,'_').replace(/[. ]+$/u,'').slice(0,70) || 'material';}
async function checkedFile(home, row) {
  const file=path.resolve(home,row.file);
  if(!isWithin(path.resolve(home,'materials'),file)) throw new Error('素材路径越界。');
  const stat=await fs.lstat(file);
  if(!stat.isFile() || stat.isSymbolicLink() || path.join(await fs.realpath(home),path.relative(path.resolve(home),file)) !== await fs.realpath(file)) throw new Error('素材必须是库内普通文件。');
  if(await shaFile(file)!==row.sha256) throw new Error('素材副本被直接修改；请通过素材更新流程处理，不覆盖未知改动。');
  return file;
}
export function sourceChanges(sources, state) {
  return sources.flatMap(source=>{
    const ref=source.material?.library;if(!ref)return [];
    const current=(state.materials||[]).find(m=>m.id===ref.id);
    if(!current)return [{id:ref.id,revision:ref.revision,status:'source-missing'}];
    if(current.revision!==ref.revision || current.sha256!==ref.sha256)return [{id:ref.id,revision:ref.revision,currentRevision:current.revision,status:'source-updated'}];
    return [];
  });
}
export function checkSourceLinks(sources,state,scope) {
  for(const source of sources){const ref=source.material?.library;if(!ref)continue;
    const row=(state.materials||[]).find(m=>m.id===ref.id && visible(m,scope));
    if(!row || row.revision!==ref.revision || row.sha256!==ref.sha256)throw new Error('引用的素材版本不存在、已更新或超出范围；先读取当前素材再保存新证据。');
  }
}
export async function listMaterials(home,{scope='personal',query='',kind,limit=20}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('素材列表每次最多 100 项。');
  if(typeof query!=='string'||query.length>300)throw new Error('素材检索词过长。');
  const terms=query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
  return ((await readState(home)).materials||[]).filter(m=>visible(m,scope)&&(!kind||m.kind===kind))
    .filter(m=>terms.every(term=>[m.title,m.originalName,...(m.aliases||[]),...(m.provenance||[]).map(p=>p.originalName),...m.tags].join(' ').toLowerCase().includes(term)))
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,limit)
    .map(({sourceRef,file,...m})=>m);
}
export async function getMaterial(home,id,scope='personal',revision) {
  const row=((await readState(home)).materials||[]).find(m=>m.id===id&&visible(m,scope));
  if(!row)throw new Error('此范围内找不到素材。');
  if (revision !== undefined && revision !== row.revision) throw new Error('仅保留当前副本；指定旧版本内容已被替换，不能用新版冒充旧版。');
  return {...row,path:await checkedFile(home,row),library:{id:row.id,revision:row.revision,sha256:row.sha256}};
}
function processAlive(pid) {try {process.kill(pid,0);return true;} catch(e) {return e.code !== 'ESRCH';}}
async function cleanupPending(home) {
  return mutateState(home,async s=>{
    const names=s.maintenance?.pendingMaterials||[];
    if(!Array.isArray(names)||names.some(n=>!/^\.material-backup-[0-9a-f-]{36}$/u.test(n)))throw new Error('素材清理记录无效。');
    for(const name of names)await fs.rm(path.join(home,name),{recursive:true,force:true});
    s.maintenance ||= {}; s.maintenance.pendingMaterials=[];
    const stages=s.maintenance.materialStages||[];
    if(stages.some(x=>!/^\.material-stage-[a-zA-Z0-9]{6}$/u.test(x.name)))throw new Error('素材暂存记录无效。');
    const removable=stages.filter(x=>x.status==='cleanup'||!processAlive(x.pid));
    for(const item of removable)await fs.rm(path.join(home,item.name),{recursive:true,force:true});
    s.maintenance.materialStages=stages.filter(x=>!removable.includes(x));
  });
}
async function changeFiles(home,fn) {
  const operationId=randomUUID();let committed=false;
  try {
    const result=await mutateState(home,async(s,transaction)=>{
      s.materials||=[];s.maintenance||={};
      const move=async(from,to)=>{await transaction.move(from,to);};
      const retire=async from=>{const name=`.material-backup-${randomUUID()}`;await move(from,path.join(home,name));s.maintenance.pendingMaterials=[...(s.maintenance.pendingMaterials||[]),name];};
      const result=await fn(s,{move,retire});s.maintenance.materialWriteId=operationId;return result;
    });
    committed=true;await cleanupPending(home);return result;
  }catch(e){
    if(!committed)committed=(await readState(home)).maintenance?.materialWriteId===operationId;
    if(committed)throw new Error(`素材索引已提交，但旧副本清理未完成；请运行 material-cleanup 重试。${e.message}`);
    throw e;
  }
}
export async function cleanupMaterials(home) {await cleanupPending(home);return {cleaned:true};}
export async function importMaterial(home,input) {
  const source=path.resolve(boundedString(input.source,'素材文件',2000));
  const stat=await fs.lstat(source);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('只导入用户指定的普通文件，不扫描目录或跟随文件链接。');
  const maxBytes=input.maxBytes??2*1024**3;if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new Error('素材容量上限必须是正整数字节。');
  if(stat.size>maxBytes)throw new Error('素材超过默认 2 GiB 或本次指定容量上限；先确认存储容量再调整 maxBytes。');
  const sourceReal=await fs.realpath(source),sha256=await shaFile(source,maxBytes),scope=input.scope||'personal';
  if((await fs.stat(source)).size!==stat.size)throw new Error('读取期间素材大小变化，请重试。');
  const title=boundedString(input.title,'素材标题',200),kind=input.kind;
  if(!materialKinds.includes(kind))throw new Error('素材分类无效。');
  const tags=[...new Set((input.tags||[]).map(t=>boundedString(t,'素材标签',100)))];if(tags.length>20)throw new Error('素材标签最多 20 项。');
  const state=await readState(home),previous=input.id?(state.materials||[]).find(m=>m.id===input.id&&m.scope===scope):null;
  if(input.id&&!previous)throw new Error('更新目标不存在或不属于此范围。');
  if(previous)await checkedFile(home,previous);
  const plan={source:sourceReal,title,kind,scope:boundedString(scope,'范围',500),tags,bytes:stat.size,sha256,maxBytes,resetId:state.maintenance?.dataResetId||null,
    sourceRef:boundedString(input.sourceRef||sourceReal,'原始来源',2000),contentDate:boundedString(input.contentDate||'未知','内容日期',100),previous:previous?{id:previous.id,revision:previous.revision,sha256:previous.sha256}:null};
  const affected = previous ? {profiles:(state.profiles||[]).filter(p=>p.versions.some(v=>v.sourceMaterials?.some(s=>s.material?.library?.id===previous.id)) || p.sourceMaterials?.some(s=>s.material?.library?.id===previous.id)).map(p=>p.id),rules:state.rules.filter(r=>r.sources.some(s=>s.material?.library?.id===previous.id)).map(r=>r.id)} : {profiles:[],rules:[]};
  const approvalHash=digest(plan);
  if(!input.apply)return {status:'preview',plan,approvalHash,affected,libraryRoot:path.join(home,'materials'),note:'原文件不变；库内仅保留当前副本。更新会替换旧副本，并使旧来源的方法与记忆待复核；不自动重新启用。'};
  if(input.approvalHash!==approvalHash)throw new Error('素材或更新目标已变化；先审阅当前预览再导入。');
  await fs.mkdir(home,{recursive:true,mode:0o700});
  const stage=await fs.mkdtemp(path.join(home,'.material-stage-'));
  const stageName=path.basename(stage);
  await mutateState(home,s=>{s.maintenance||={};s.maintenance.materialStages=[...(s.maintenance.materialStages||[]),{name:stageName,pid:process.pid,status:'active'}];});
  try{
    const staged=path.join(stage,'source');await fs.copyFile(sourceReal,staged);await fs.chmod(staged,0o600);
    if((await fs.stat(staged)).size!==stat.size || await shaFile(staged,maxBytes)!==sha256)throw new Error('复制期间原文件变化，未导入。');
    return await changeFiles(home,async(s,{move,retire})=>{
      if((s.maintenance.dataResetId||null)!==plan.resetId)throw new Error('素材库已清空，先重新预览，不能恢复清空前启动的导入。');
      const current=previous?s.materials.find(m=>m.id===previous.id):null;
      if(previous&&(!current||current.revision!==previous.revision||current.sha256!==previous.sha256))throw new Error('素材已被另一操作更新；请重新预览。');
      const duplicate=s.materials.find(m=>m.scope===scope&&m.sha256===sha256);
      if(duplicate){await checkedFile(home,duplicate);if(previous&&duplicate.id!==previous.id)throw new Error('新内容已在另一素材中；请复用其编号，不隐式合并引用。');duplicate.aliases=[...new Set([...(duplicate.aliases||[]),title])].slice(0,50);
        const combinedTags=[...new Set([...duplicate.tags,...tags])];
        if(combinedTags.length>20)throw new Error('合并后素材标签超过 20 项，请精简标签。');
        duplicate.tags=combinedTags;
        duplicate.provenance ||= [{sourceRef:duplicate.sourceRef,originalName:duplicate.originalName,contentDate:duplicate.contentDate||'未知'}];
        const arrival={sourceRef:plan.sourceRef,sourcePath:sourceReal,originalName:path.basename(source),contentDate:plan.contentDate};
        if(!duplicate.provenance.some(p=>JSON.stringify(p)===JSON.stringify(arrival))) duplicate.provenance.push(arrival);
        return {status:'reused',material:duplicate,noDuplicateCopy:true,note:'相同字节仅复用副本；不同提供者和事件归属仍须分别核实。'};}
      if(current)await checkedFile(home,current);
      const id=previous?.id||randomUUID(),extension=path.extname(source).toLowerCase();
      if(extension.length>20||!/^[.a-z0-9_-]*$/u.test(extension))throw new Error('文件扩展名无效。');
      const directory=path.join(home,'materials',kind,id),filename=`${safeTitle(title)}__${id.slice(0,8)}__r${String((previous?.revision||0)+1).padStart(4,'0')}${extension}`;
      const file=path.join(directory,filename);
      if(current)await retire(path.dirname(path.join(home,current.file)));
      await libraryDirectory(home,directory);
      if(!isWithin(await fs.realpath(home),await fs.realpath(directory)))throw new Error('素材目录越界。');
      await move(staged,file);
      const row={id,title,kind,scope,tags,revision:(previous?.revision||0)+1,sha256,bytes:stat.size,file:path.relative(home,file),sourceRef:plan.sourceRef,contentDate:plan.contentDate,aliases:previous?.aliases||[],provenance:[{sourceRef:plan.sourceRef,sourcePath:sourceReal,originalName:path.basename(source),contentDate:plan.contentDate}],originalName:path.basename(source),createdAt:previous?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
      s.materials=s.materials.filter(m=>m.id!==id);s.materials.push(row);
      return {status:previous?'updated':'imported',material:row,path:file,previousRevision:previous?.revision||null,oldCopyRetained:false};
    });
  }finally{
    try {await fs.rm(stage,{recursive:true,force:true});await mutateState(home,s=>{s.maintenance.materialStages=(s.maintenance.materialStages||[]).filter(x=>x.name!==stageName);});}
    catch(e){await mutateState(home,s=>{const row=s.maintenance.materialStages?.find(x=>x.name===stageName);if(row)row.status='cleanup';});throw new Error(`素材暂存清理未完成；请运行 material-cleanup 重试。${e.message}`);}
  }
}
export async function deleteMaterial(home,id,input={}) {
  const row=await getMaterial(home,id,input.scope||'personal');
  if(row.scope !== (input.scope||'personal')) throw new Error('删除必须明确使用素材所属范围。');
  const plan={id:row.id,revision:row.revision,sha256:row.sha256,scope:row.scope};const approvalHash=digest(plan);
  if(!input.apply)return {status:'preview',plan,approvalHash,note:'只删素材库副本与索引。原文件、派生方法和必要摘录保留；引用该素材的产物将待复核。这不是彻底忘记。'};
  if(input.approvalHash!==approvalHash)throw new Error('删除目标已变化，请重新预览。');
  return changeFiles(home,async(s,{retire})=>{const current=s.materials.find(m=>m.id===id&&m.revision===row.revision&&m.sha256===row.sha256);if(!current)throw new Error('素材已变化。');await retire(path.dirname(path.join(home,current.file)));s.materials=s.materials.filter(m=>m.id!==id);return {status:'deleted',id,originalDeleted:false,derivedEvidenceDeleted:false};});
}
