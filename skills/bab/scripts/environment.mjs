import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {dataHome} from './store.mjs';

export async function doctor(home = dataHome()) {
  const candidates = {
    codex: {skills: path.join(os.homedir(), '.agents', 'skills'), legacySkills: path.join(os.homedir(), '.codex', 'skills'), history: path.join(os.homedir(), '.codex', 'sessions')},
    claude: {skills: path.join(os.homedir(), '.claude', 'skills'), history: path.join(os.homedir(), '.claude', 'projects')}
  };
  const hosts = {};
  for (const [host, paths] of Object.entries(candidates)) {
    hosts[host] = {};
    for (const [key, value] of Object.entries(paths)) {
      let exists = false;
      try {exists = (await fs.stat(value)).isDirectory();} catch {}
      hosts[host][key] = {path: value, exists};
    }
  }
  return {runtime: process.versions.bun ? `Bun ${process.versions.bun} compiled/source` : `Node ${process.versions.node}`,
    platform: process.platform, arch: process.arch, dataHome: home, hosts,
    historyContentRead: false, notes: [
      '发现目录不代表宿主已加载 Skill。安装后需要按宿主提示刷新或打开新会话。',
      '首次读取历史前，确认平台、目录、会话范围及用途。',
      '脚本在本地读取；传给当前 AI 的内容仍受宿主模型的数据处理方式约束。'
    ]};
}
