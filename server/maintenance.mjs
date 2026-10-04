import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {atomicJSON,mutateState,readState} from '../skills/bab/scripts/store.mjs';
export async function maintainInbox(home,now=Date.now()){
 let purged=0;await mutateState(home,s=>{for(const row of s.inbox||[]){if(row.status!=='closed'||row.purgedAt||!row.closedAt||now-Date.parse(row.closedAt)<90*86400000)continue;row.report={id:row.report.id,version:row.report.version,skill:row.report.skill,goal:'内容已按保留期限清理',actual:'已归档反馈',environment:{}};row.note='';row.reply='';row.closeReason='';row.purgedAt=new Date(now).toISOString();purged++;}});
 const backups=path.join(home,'backups');await fs.mkdir(backups,{recursive:true,mode:0o700});const date=new Date(now).toISOString().slice(0,10);await atomicJSON(path.join(backups,date+'.json'),await readState(home));
 for(const file of await fs.readdir(backups)){if(!/^\d{4}-\d{2}-\d{2}\.json$/.test(file))continue;if(now-Date.parse(file.slice(0,10)+'T00:00:00Z')>=7*86400000)await fs.rm(path.join(backups,file));}
 return {purged,backup:date};
}
if(process.argv[1]&&await fs.realpath(process.argv[1]).catch(()=>null)===fileURLToPath(import.meta.url)){if(!process.env.BAB_INBOX_HOME)throw Error('缺少数据目录');console.log(JSON.stringify(await maintainInbox(process.env.BAB_INBOX_HOME)));}
