import http from 'node:http';
import {timingSafeEqual, randomBytes} from 'node:crypto';
import path from 'node:path';
import {readState, mutateState} from '../skills/bab/scripts/store.mjs';
import {fileURLToPath} from 'node:url';

const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function feedbackServer({home, adminToken, maxPerHour = 30}) {
  if (!adminToken || adminToken.length < 32) throw new Error('后台令牌至少 32 字符，从环境变量提供。');
  const rates = new Map();
  const reply = (res, code, data) => {res.writeHead(code, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}); res.end(JSON.stringify(data));};
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'POST' && url.pathname === '/v1/feedback') {
        const address = req.socket.remoteAddress;
        const now = Date.now();
        for (const [key, row] of rates) if (row.reset < now) rates.delete(key);
        if (!rates.has(address) && rates.size >= 10000) return reply(res, 503, {error: 'busy'});
        const rate = rates.get(address) || {count: 0, reset: now + 3600000}; rate.count++; rates.set(address, rate);
        if (rate.count > maxPerHour) return reply(res, 429, {error: 'rate-limit'});
        const chunks = []; let size = 0;
        for await (const chunk of req) {size += chunk.length; if (size > 40000) {reply(res, 413, {error: 'too-large'}); return;} chunks.push(chunk);}
        const raw = Buffer.concat(chunks).toString('utf8');
        let report; try {report = JSON.parse(raw);} catch {return reply(res, 400, {error: 'invalid-json'});}
        if (!/^[a-f0-9-]{36}$/u.test(report.id || '') || req.headers['idempotency-key'] !== report.id) return reply(res, 400, {error: 'invalid-id'});
        for (const key of ['version', 'skill', 'goal', 'expected', 'actual', 'steps', 'observed', 'hypothesis', 'suggestion'])
          if (typeof report[key] !== 'string' || !report[key].trim() || report[key].length > 4000) return reply(res, 400, {error: `invalid-${key}`});
        const clean = Object.fromEntries(['id', 'version', 'skill', 'goal', 'expected', 'actual', 'steps', 'observed', 'hypothesis', 'suggestion', 'excerpt'].map(k => [k, String(report[k] || '').slice(0, 4000)]));
        const receipt = await mutateState(home, state => {
          state.inbox ||= [];
          const previous = state.inbox.find(x => x.report.id === report.id);
          if (previous) {
            if (JSON.stringify(previous.report) !== JSON.stringify(clean)) throw new Error('id-conflict');
            return {id: previous.report.id, token: previous.token};
          }
          const row = {report: clean, token: randomBytes(32).toString('hex'), status: 'received', fixedIn: null, receivedAt: new Date().toISOString()};
          state.inbox.push(row); return {id: report.id, token: row.token};
        });
        return reply(res, 201, receipt);
      }
      if (req.method === 'GET' && url.pathname === '/admin/feedback') {
        if (!equal(req.headers.authorization, `Bearer ${adminToken}`)) return reply(res, 401, {error: 'unauthorized'});
        const state = await readState(home); return reply(res, 200, {items: (state.inbox || []).map(({token, ...row}) => row)});
      }
      const match = url.pathname.match(/^\/v1\/feedback\/([a-f0-9-]{36})$/u);
      if (req.method === 'GET' && match) {
        const state = await readState(home); const row = state.inbox?.find(x => x.report.id === match[1]);
        if (!row || !equal(req.headers.authorization, `Bearer ${row.token}`)) return reply(res, 404, {error: 'not-found'});
        return reply(res, 200, {id: row.report.id, status: row.status, fixedIn: row.fixedIn});
      }
      return reply(res, 404, {error: 'not-found'});
    } catch (e) {return reply(res, e.message === 'id-conflict' ? 409 : 500, {error: e.message === 'id-conflict' ? e.message : 'internal-error'});}
  });
}

export async function markResolved(home, id, version) {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error('需要修复版本号。');
  return mutateState(home, s => {const row = s.inbox?.find(x => x.report.id === id); if (!row) throw new Error('找不到反馈。'); row.status = 'resolved'; row.fixedIn = version; return {id, version};});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const home = process.env.BAB_INBOX_HOME; if (!home) throw new Error('设置 BAB_INBOX_HOME，勿放入 Git。');
  const server = feedbackServer({home, adminToken: process.env.BAB_ADMIN_TOKEN});
  server.listen(Number(process.env.PORT || 8787), '127.0.0.1', () => console.log('私有反馈服务：http://127.0.0.1:' + server.address().port));
}
