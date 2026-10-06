import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export function dataHome() {
  if (process.env.BAB_HOME) return path.resolve(process.env.BAB_HOME);
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'borrow-a-brain');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'borrow-a-brain');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'borrow-a-brain');
}

export const emptyState = () => ({schema: 1, rules: [], grants: [], feedback: [], tasks: {}, resources: {}, settings: {resources: true}, maintenance: {}});

export async function atomicJSON(file, value) {
  await fs.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  const temp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temp, file);
  } finally {
    await handle?.close();
    await fs.rm(temp, {force: true});
  }
}

export async function readState(home = dataHome()) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(home, 'state.json'), 'utf8'));
    if (data.schema !== 1 || !Array.isArray(data.rules) || !Array.isArray(data.grants)) throw new Error('记忆格式不受支持；保留原文件，请使用兼容版本。');
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    throw error;
  }
}

async function recoverFileTransaction(home, state) {
  const journalFile = path.join(home, 'file-transaction.json');
  let journal;
  try {journal = JSON.parse(await fs.readFile(journalFile, 'utf8'));} catch (e) {if (e.code === 'ENOENT') return; throw e;}
  if (!/^[0-9a-f-]{36}$/u.test(journal.id) || !Array.isArray(journal.moves) || journal.moves.length > 100) throw new Error('文件事务记录无效，保留现场。');
  const moves = journal.moves.map(([from, to]) => {
    if (![from, to].every(x => typeof x === 'string' && x && !path.isAbsolute(x) && isWithin(home, path.resolve(home, x)))) throw new Error('文件事务路径越界。');
    return [path.resolve(home, from), path.resolve(home, to)];
  });
  if (state.maintenance?.fileTransactionId !== journal.id) {
    for (const [from, to] of moves.reverse()) {
      let destination;
      try {destination = await fs.lstat(to);} catch (e) {if (e.code === 'ENOENT') continue; throw e;}
      try {
        const original = await fs.lstat(from);
        if (!original.isDirectory() || !destination.isDirectory()) throw new Error('文件事务恢复遇到冲突，保留两份文件。');
        await fs.rmdir(from); // Only remove an empty directory created during the failed transaction.
      } catch (e) {if (e.code !== 'ENOENT') throw e;}
      await fs.rename(to, from);
    }
  }
  await fs.rm(journalFile, {force: true});
}

function fileTransaction(home, state) {
  const journal = {id: randomUUID(), moves: []};
  return {move: async (from, to) => {
    if (![from, to].every(x => isWithin(path.resolve(home), path.resolve(x)))) throw new Error('文件事务路径越界。');
    await fs.lstat(from);
    try {await fs.lstat(to); throw new Error('文件事务目标已存在，未覆盖。');} catch (e) {if (e.code !== 'ENOENT') throw e;}
    journal.moves.push([path.relative(home, from), path.relative(home, to)]);
    await atomicJSON(path.join(home, 'file-transaction.json'), journal);
    state.maintenance ||= {}; state.maintenance.fileTransactionId = journal.id;
    await fs.rename(from, to);
  }};
}

export async function mutateState(home, fn, timeout = 5000) {
  await fs.mkdir(home, {recursive: true, mode: 0o700});
  const lock = path.join(home, 'write.lock');
  const start = Date.now();
  let handle;
  while (!handle) {
    try { handle = await fs.open(lock, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - start > timeout) throw new Error('本地记录正在写入，或上次写入中断。未覆盖数据；请检查 write.lock 的进程信息。');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try {
    await handle.writeFile(JSON.stringify({pid: process.pid, created: new Date().toISOString()}));
    const state = await readState(home);
    await recoverFileTransaction(home, state);
    try {
      const result = await fn(state, fileTransaction(home, state));
      await atomicJSON(path.join(home, 'state.json'), state);
      await recoverFileTransaction(home, state);
      return result;
    } catch (e) {
      // Recover under the same lock. Read the committed state: atomic rename may
      // have succeeded even when later cleanup raised an error.
      await recoverFileTransaction(home, await readState(home));
      throw e;
    }
  } finally { await handle.close(); await fs.rm(lock, {force: true}); }
}

export function boundedString(value, name, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name}需要 1–${max} 个字符。`);
  return value.trim();
}

export function isWithin(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

// One reset transaction: writers serialize at the same state lock as profile creation.
// Writes committed after this reset are new data, not failed deletion of older data.
export async function clearDerivedData(home) {
  const resetId = randomUUID();
  let committed = false;
  let pending = [];
  try {
    const result = await mutateState(home, async (s, transaction) => {
      s.maintenance ||= {};
      pending = [...(s.maintenance.pendingClear || []), ...(s.maintenance.pendingMaterials || []), ...(s.maintenance.materialStages || []).map(x => x.name)];
      if (!Array.isArray(pending) || pending.some(name => !/^\.(?:(?:clear|material-backup|delete)-[0-9a-f-]{36}|material-stage-[a-zA-Z0-9]{6})$/u.test(name))) throw new Error('清理记录无效，保留文件等待检查。');
      for (const name of ['people', 'materials']) {
        const original = path.join(home, name), trashName = `.clear-${randomUUID()}`, trash = path.join(home, trashName);
        try {await transaction.move(original, trash); pending.push(trashName);} catch (e) {if (e.code !== 'ENOENT') throw e;}
      }
      pending = [...new Set(pending)];
      const removedProfiles = (s.profiles || []).length;
      s.profiles = []; s.materials = []; s.maintenance.pendingMaterials = []; s.maintenance.materialStages = []; s.maintenance.profileDeletes = {}; s.rules = []; s.grants = []; s.feedback = []; s.tasks = {}; s.resources = {}; s.settings = {resources: false};
      s.maintenance.pendingClear = pending; s.maintenance.dataResetId = resetId;
      return {cleared: true, removedProfiles, semantics: 'atomic-reset',
        scope: '同一次加锁提交前的全部本套件派生数据；提交后明确新建的数据不属于本次清除',
        preserved: '安装回执和宿主原始记录；服务端已发送反馈与手动导出副本不在本地清除范围'};
    });
    committed = true;
    for (const name of pending) await fs.rm(path.join(home, name), {recursive: true, force: true});
    await mutateState(home, s => {s.maintenance.pendingClear = (s.maintenance.pendingClear || []).filter(name => !pending.includes(name));});
    return result;
  } catch (e) {
    // A state commit may have succeeded even if lock cleanup failed afterwards.
    if (!committed) committed = (await readState(home)).maintenance?.dataResetId === resetId;
    if (committed) throw new Error(`索引已重置，但清理未完成；检查写锁或权限后重试 data-clear，将继续清理已登记旧文件。${e.message}`);
    throw e;
  }
}
