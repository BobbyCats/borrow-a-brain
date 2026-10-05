import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {install} from './install.mjs';

// Paths follow each host's documented local discovery rules; no global writes by default.
export async function setup(home, {host, project, global = false, apply = false}, userHome = os.homedir()) {
  if (!['codex', 'claude'].includes(host)) throw new Error('安装宿主选择 codex 或 claude；其他应用先核对官方目录。');
  if (global && project) throw new Error('全局安装与项目安装只能选一个。');
  if (!global && !project) throw new Error('请提供项目目录；全局安装需明确使用 --user。');
  const root = global ? userHome : await fs.realpath(project);
  if (!(await fs.stat(root)).isDirectory()) throw new Error('项目路径必须是目录。');
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const skillsDir = path.join(root, host === 'codex' ? '.agents/skills' : '.claude/skills');
  const rulesFile = path.join(root, global ? host === 'codex' ? '.codex/AGENTS.md' : '.claude/CLAUDE.md' : host === 'codex' ? 'AGENTS.md' : 'CLAUDE.md');
  return {...await install(home, {source, skillsDir, rulesFile, scopeRoot: root, apply}), host,
    scope: global ? 'user' : 'project', nextCheck: '开启该目录的新会话，说“我有件事拿不定主意，你帮我捋一捋”，检查是否展示实际调用。'};
}
