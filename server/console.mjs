import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes, timingSafeEqual, scryptSync} from 'node:crypto';
import {feedbackServer} from './feedback.mjs';
import {readState, mutateState} from '../skills/bab/scripts/store.mjs';

export const states={received:'已收到',working:'处理中',waiting:'待补充',resolved:'已随版本修复',closed:'已关闭'};
export function passwordHash(password,salt=randomBytes(16).toString('hex')){return salt+':'+scryptSync(password,salt,32).toString('hex');}
function same(a,b){return typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>40000)throw Object.assign(Error('内容过长'),{status:413});}try{return JSON.parse(text);}catch{throw Object.assign(Error('请求格式不正确'),{status:400});}}
export function consoleServer({home,adminToken,loginHash,origin,html,versions,secure=true,trustProxy=false}){
  if(!/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(loginHash))throw Error('需要有效管理员口令哈希');
  const sessions=new Map(),attempts=new Map();
  const cookieName=secure?'__Host-jclab_session':'jclab_session';
  const cookie=(value,age)=>`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`;
  const reply=(res,status,data,headers={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow',...headers});res.end(JSON.stringify(data));};
  const getSession=req=>{const id=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);const s=sessions.get(id);if(!s||s.expires<Date.now()){sessions.delete(id);return null;}return {...s,id};};
  const middleware=async(req,res)=>{
    const url=new URL(req.url,origin);
    const session=getSession(req);
    const auth=same(req.headers.authorization,`Bearer ${adminToken}`);
    const fail=(code,error)=>{reply(res,code,{error});return true;};
    const safeWrite=()=>req.headers.origin===origin&&session&&same(req.headers['x-csrf-token'],session.csrf);
    try{
      if(req.method==='GET'&&url.pathname==='/health'){reply(res,200,{ok:true});return true;}
      if(req.method==='GET'&&url.pathname==='/admin/feedback/'){
        res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex, nofollow','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'"});res.end(await fs.readFile(html));return true;
      }
      if(url.pathname==='/session'){
        if(req.method==='GET'){reply(res,200,{authenticated:!!session,csrf:session?.csrf});return true;}
        if(req.method==='POST'){
          if(req.headers.origin!==origin)return fail(403,'请求来源不正确，请刷新页面');
          const address=trustProxy?(req.headers['x-real-ip']||req.socket.remoteAddress):req.socket.remoteAddress;
          for(const [id,x] of attempts)if(x.until<Date.now())attempts.delete(id);
          for(const [id,x] of sessions)if(x.expires<Date.now())sessions.delete(id);
          if(attempts.size>10000||sessions.size>1000)return fail(503,'请稍后重试');
          const attempt=attempts.get(address)||{n:0,until:Date.now()+15*60*1000};
          if(attempt.n>=10)return fail(429,'尝试次数较多，请 15 分钟后再试');
          const input=await body(req);attempt.n++;attempts.set(address,attempt);
          if(typeof input.password!=='string'||input.password.length>256||!same(passwordHash(input.password,loginHash.split(':')[0]),loginHash))return fail(401,'访问口令不正确');
          attempts.delete(address);if(session)sessions.delete(session.id);
          const id=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');sessions.set(id,{csrf,expires:Date.now()+8*60*60*1000});
          reply(res,200,{authenticated:true,csrf},{'set-cookie':cookie(id,8*60*60)});return true;
        }
        if(req.method==='DELETE'){if(!safeWrite())return fail(403,'登录已失效，请重新登录');sessions.delete(session.id);reply(res,200,{authenticated:false},{'set-cookie':cookie('',0)});return true;}
        return fail(405,'不支持这个操作');
      }
      if(url.pathname==='/admin/feedback'){
        if(!session&&!auth)return fail(401,'请先登录');
        if(req.method!=='GET')return fail(405,'不支持这个操作');
        const state=await readState(home);
        reply(res,200,{states,versions:await versions(),items:(state.inbox||[]).map(({token,...row})=>row).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt))});return true;
      }
      const match=url.pathname.match(/^\/admin\/feedback\/([a-f0-9-]{36})$/);
      if(match){
        if(!session&&!auth)return fail(401,'请先登录');
        if(req.method!=='PATCH')return fail(405,'不支持这个操作');
        if(!auth&&!safeWrite())return fail(403,'操作验证已失效，请刷新后再试');
        const input=await body(req);
        if(!Object.hasOwn(states,input.status))return fail(400,'请选择有效状态');
        for(const key of ['note','reply','fixedIn','closeReason'])if(input[key]!==undefined&&(typeof input[key]!=='string'||input[key].length>4000))return fail(400,'内容格式或长度不正确');
        if(input.status==='resolved'&&!(await versions()).includes(input.fixedIn))return fail(400,'修复版本必须是已经发布的版本');
        if(input.status==='closed'&&!input.closeReason?.trim())return fail(400,'请填写结案说明');
        const updated=await mutateState(home,s=>{
          const row=s.inbox?.find(x=>x.report.id===match[1]);if(!row)throw Object.assign(Error('找不到这条反馈'),{status:404});
          if(input.revision!==(row.revision||0))throw Object.assign(Error('反馈已在其他窗口更新，请刷新后再保存'),{status:409});
          const previous=row.status;row.status=input.status;row.note=input.note?.trim()||'';row.reply=input.reply?.trim()||'';row.fixedIn=input.status==='resolved'?input.fixedIn:(input.status==='closed'?row.fixedIn:null);row.closeReason=input.status==='closed'?input.closeReason.trim():null;row.updatedAt=new Date().toISOString();row.closedAt=input.status==='closed'?(row.closedAt||row.updatedAt):null;row.revision=(row.revision||0)+1;
          row.audit||=[];row.audit.push({at:row.updatedAt,from:previous,to:row.status,fixedIn:row.fixedIn,actor:'owner'});
          const {token,...publicRow}=row;return publicRow;
        });reply(res,200,{item:updated});return true;
      }
      return false;
    }catch(e){return fail(e.status||500,e.status?e.message:'暂时无法完成操作，内容未确认保存，请稍后重试');}
  };
  return feedbackServer({home,adminToken,middleware,trustProxy});
}
if(process.argv[1]&&await fs.realpath(process.argv[1]).catch(()=>null)===fileURLToPath(import.meta.url)){
  const required=['BAB_INBOX_HOME','BAB_ADMIN_TOKEN','BAB_LOGIN_HASH','BAB_ORIGIN','BAB_ADMIN_HTML','BAB_RELEASES_FILE'];for(const x of required)if(!process.env[x])throw Error(`缺少 ${x}`);
  const versions=async()=>{const data=JSON.parse(await fs.readFile(process.env.BAB_RELEASES_FILE,'utf8'));return data.versions;};
  const server=consoleServer({home:process.env.BAB_INBOX_HOME,adminToken:process.env.BAB_ADMIN_TOKEN,loginHash:process.env.BAB_LOGIN_HASH,origin:process.env.BAB_ORIGIN,html:process.env.BAB_ADMIN_HTML,versions,secure:process.env.BAB_LOCAL!=='1',trustProxy:process.env.BAB_TRUST_PROXY==='1'});
  server.listen(Number(process.env.PORT||8791),'127.0.0.1',()=>console.log('JC LAB feedback service ready'));
}
