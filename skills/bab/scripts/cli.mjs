import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dataHome, readState, mutateState} from './store.mjs';
import {doctor} from './environment.mjs';
import {grantHistory, revokeHistory, readHistory} from './history.mjs';
import {addRule, listRules, queryRules, supersedeRule, forgetRule} from './memory.mjs';
import {install, uninstall} from './install.mjs';
import {draftFeedback, sendFeedback, feedbackStatus, recordCorrection, resourceGate} from './feedback.mjs';
import {checkUpdate, applyUpdate} from './update.mjs';
import {createProfile, listProfiles, saveProfileVersion, getProfile, resolveProfile, activateProfile, deleteProfile, exportProfile} from './profiles.mjs';
import {routingCatalog, saveRoute, loadRoute} from './routing.mjs';
import {readConfig, saveConfig} from './config.mjs';

export async function main(argv = process.argv.slice(2)) {
  const [command = 'help', ...args] = argv; const home = dataHome();
  const version = JSON.parse(await fs.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'version.json'), 'utf8')).version;
  const json = async file => {if (!file) throw new Error('请提供 JSON 参数文件。'); return JSON.parse(await fs.readFile(file, 'utf8'));};
  const commands = {
    doctor: () => doctor(home),
    'config-get': () => readConfig(home),
    'config-set': async () => saveConfig(home, await json(args[0])),
    'profile-create': async () => createProfile(home, await json(args[0])),
    'profile-list': () => listProfiles(home, args[0] || 'personal'),
    'profile-save': async () => saveProfileVersion(home, args[0], await json(args[1])),
    'profile-get': () => getProfile(home, args[0], {version: args[1] === 'active' ? undefined : args[1], scope: args[2] || 'personal'}),
    'profile-resolve': () => resolveProfile(home, args[0], args[1] || 'personal'),
    'profile-activate': () => activateProfile(home, args[0], args[1], args[2], args[3] || 'personal'),
    'profile-delete': () => deleteProfile(home, args[0]),
    'profile-export': async () => exportProfile(home, args[0], await json(args[1])),
    'route-catalog': () => routingCatalog(home, args[0] || 'personal'),
    'route-save': async () => saveRoute(home, await json(args[0])),
    'route-load': () => loadRoute(home, args[0], args[1] || 'personal'),
    'history-grant': async () => grantHistory(home, await json(args[0])),
    'history-read': () => readHistory(home, args[0], {limit: args[1] ? Number(args[1]) : 10}),
    'history-revoke': () => revokeHistory(home, args[0]),
    'memory-add': async () => addRule(home, await json(args[0])),
    'memory-list': () => listRules(home, {scope: args[0] || 'personal'}),
    'memory-query': () => queryRules(home, args[0], args[1] || 'personal'),
    'memory-replace': async () => supersedeRule(home, args[0], await json(args[1])),
    'memory-forget': () => forgetRule(home, args[0]),
    install: async () => install(home, await json(args[0])),
    uninstall: () => uninstall(home, args[0]),
    'feedback-draft': async () => draftFeedback(home, await json(args[0])),
    'feedback-send': () => sendFeedback(home, args[0], args[1]),
    'feedback-status': () => feedbackStatus(home, args[0]),
    'feedback-delete': () => mutateState(home, s => {const n = s.feedback.length; s.feedback = s.feedback.filter(x => x.report.id !== args[0]); return {deleted: n - s.feedback.length, serverCopyDeleted: false};}),
    'correction': async () => recordCorrection(home, args[0], await json(args[1])),
    'resource': async () => resourceGate(home, await json(args[0])),
    'update-check': async () => checkUpdate(home, await json(args[0]), args[1], {force: args.includes('--force')}),
    'update-apply': async () => applyUpdate(home, await json(args[0])),
    'data-clear': async () => {
      if (args[0] !== '--confirmed') throw new Error('清除全部派生记忆与授权需要用户确认；传入 --confirmed。');
      const before = await readState(home);
      for (const p of before.profiles || []) await deleteProfile(home, p.id);
      return mutateState(home, s => {s.rules = []; s.grants = []; s.feedback = []; s.tasks = {}; s.resources = {}; s.settings = {resources: false}; return {cleared: true, preserved: '安装回执和宿主原始记录；服务端已发送反馈不在本地清除范围'};});
    },
    help: () => ({name: '借个脑子', version, commands: Object.keys(commands),
      usage: '大部分变更命令接收 JSON 文件。参见 references/operations.md。不要把私人参数文件放入 Git。', dataHome: home})
  };
  if (!commands[command]) throw new Error(`未知命令：${command}`);
  return commands[command]();
}
