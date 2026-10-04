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
    const result = await fn(state);
    await atomicJSON(path.join(home, 'state.json'), state);
    return result;
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
