import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dataHome, clearDerivedData, mutateState} from './store.mjs';
import {doctor, projectContext} from './environment.mjs';
import {grantHistory, revokeHistory, readHistory} from './history.mjs';
import {addRule, listRules, queryRules, supersedeRule, forgetRule} from './memory.mjs';
import {install, uninstall} from './install.mjs';
import {draftFeedback, sendFeedback, feedbackStatus, recordCorrection, resourceGate} from './feedback.mjs';
import {checkUpdate, applyUpdate} from './update.mjs';
import {createProfile, intakeProfile, listProfiles, saveProfileVersion, getProfile, resolveProfile, activateProfile, deleteProfile, exportProfile} from './profiles.mjs';
import {routingCatalog, routingContext, saveRoute, loadRoute, listRoutes, checkpointRoute} from './routing.mjs';
import {readConfig, saveConfig} from './config.mjs';
import {setup} from './setup.mjs';
import {importMaterial, listMaterials, getMaterial, deleteMaterial, cleanupMaterials} from './materials.mjs';
import {parseArguments, usageFor} from './arguments.mjs';
import {startJudgment, setJudgments, challengeJudgment, loadJudgment, listJudgments, deleteJudgment} from './judgments.mjs';

export async function main(argv = process.argv.slice(2)) {
  const [command = 'help', ...rawArgs] = argv;
  const args = parseArguments(command, rawArgs); const home = dataHome();
  const version = JSON.parse(await fs.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'version.json'), 'utf8')).version;
  const json = async file => {if (!file) throw new Error('请提供 JSON 参数文件。'); return JSON.parse(await fs.readFile(file, 'utf8'));};
  const commands = {
    doctor: () => doctor(home),
    context: () => projectContext(home, args[0]),
    'config-get': () => readConfig(home),
    'config-set': async () => saveConfig(home, await json(args[0])),
    'material-import': async () => importMaterial(home, await json(args[0])),
    'material-list': () => listMaterials(home, {scope: args[0] || 'personal', query: args[1] || '', kind: args[2]}),
    'material-get': () => getMaterial(home, args[0], args[1] || 'personal', args[2] === undefined ? undefined : Number(args[2])),
    'material-delete': async () => deleteMaterial(home, args[0], await json(args[1])),
    'material-cleanup': () => cleanupMaterials(home),
    'profile-create': async () => createProfile(home, await json(args[0])),
    'profile-intake': async () => intakeProfile(home, await json(args[0])),
    'profile-list': () => listProfiles(home, args[0] || 'personal'),
    'profile-save': async () => saveProfileVersion(home, args[0], await json(args[1])),
    'profile-get': () => getProfile(home, args[0], {version: args[1] === 'active' ? undefined : args[1], scope: args[2] || 'personal'}),
    'profile-resolve': () => resolveProfile(home, args[0], args[1] || 'personal'),
    'profile-activate': () => activateProfile(home, args[0], args[1], args[2], args[3] || 'personal'),
    'profile-delete': () => deleteProfile(home, args[0]),
    'profile-export': async () => exportProfile(home, args[0], await json(args[1])),
    'route-catalog': () => routingCatalog(home, args[0] || 'personal'),
    'route-context': () => routingContext(home, {project: args.find(a => a !== '--personal'), personal: args.includes('--personal')}),
    'route-save': async () => saveRoute(home, await json(args[0])),
    'route-load': () => loadRoute(home, args[0], args[1] || 'personal'),
    'route-list': () => listRoutes(home, {scope: args[0] || 'personal', query: args[1] || ''}),
    'route-checkpoint': async () => checkpointRoute(home, args[0], await json(args[1])),
    'judgment-start': async () => startJudgment(home, await json(args[0])),
    'judgment-set': async () => setJudgments(home, args[0], await json(args[1])),
    'judgment-challenge': async () => challengeJudgment(home, args[0], await json(args[1])),
    'judgment-load': () => loadJudgment(home, args[0], args[1]),
    'judgment-list': () => listJudgments(home, args[0]),
    'judgment-delete': () => deleteJudgment(home, args[0], args[1]),
    'history-grant': async () => grantHistory(home, await json(args[0])),
    'history-read': () => readHistory(home, args[0], {limit: args[1] ? Number(args[1]) : 10}),
    'history-revoke': () => revokeHistory(home, args[0]),
    'memory-add': async () => addRule(home, await json(args[0])),
    'memory-list': () => listRules(home, {scope: args[0] || 'personal'}),
    'memory-query': () => queryRules(home, args[0], args[1] || 'personal'),
    'memory-replace': async () => supersedeRule(home, args[0], await json(args[1])),
    'memory-forget': () => forgetRule(home, args[0]),
    install: async () => install(home, await json(args[0])),
    setup: () => {
      const [host, ...rest] = args;
      if (rest.some(a => a.startsWith('--') && !['--apply', '--user'].includes(a)) || rest.filter(a => !a.startsWith('--')).length > 1) throw new Error(`用法：${usageFor('setup')}`);
      return setup(home, {host, project: rest.find(a => !a.startsWith('--')), global: rest.includes('--user'), apply: rest.includes('--apply')});
    },
    uninstall: () => uninstall(home, args[0]),
    'feedback-draft': async () => draftFeedback(home, await json(args[0])),
    'feedback-send': () => sendFeedback(home, args[0], args[1]),
    'feedback-status': () => feedbackStatus(home, args[0], {currentVersion: version, skillsDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')}),
    'feedback-delete': () => mutateState(home, s => {const n = s.feedback.length; s.feedback = s.feedback.filter(x => x.report.id !== args[0]); return {deleted: n - s.feedback.length, serverCopyDeleted: false};}),
    'correction': async () => recordCorrection(home, args[0], await json(args[1])),
    'resource': async () => resourceGate(home, await json(args[0])),
    'update-check': async () => {
      const positional = args.filter(arg => arg !== '--force');
      const config = positional.length ? await json(positional[0]) : (await readConfig(home)).config.update;
      return checkUpdate(home, config, positional[1] ?? version, {
        skillsDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), force: args.includes('--force')});
    },
    'update-apply': async () => applyUpdate(home, await json(args[0])),
    'data-clear': async () => {
      if (args[0] !== '--confirmed') throw new Error('清除全部派生记忆与授权需要用户确认；传入 --confirmed。');
      return clearDerivedData(home);
    },
    help: async () => {
      if (!args[0]) return {name: '借个脑子', version, commands: Object.keys(commands),
        usage: '大部分变更命令接收 JSON 文件。参见 references/operations.md。不要把私人参数文件放入 Git。', dataHome: home};
      const result = {command: args[0], usage: usageFor(args[0]), scope: '方法查询与任务分工沿用 route-context 返回的 scope；新方法收录按内容建议保存范围并确认。参数形式见 usage 与 references/operations.md。'};
      if (args[0] === 'update-check') return {...result,
        defaults: '不带位置参数时，自动读取当前数据目录的作者配置（没有则用本安装内置配置）和本安装的版本。配置损坏时报错，不回退或改写配置。',
        explicit: '需要指定时，更新配置文件与当前版本必须一起提供；文件格式为 {"sources":[],"publicKey":null}。',
        force: '--force 仅跳过检查间隔，不跳过签名校验，也不安装更新。',
        confirmation: '仅检查版本和已发送反馈；安装仍需展示变化并取得用户确认。'};
      if (args[0] === 'route-context') return {...result, scope: '位置参数是项目目录，不是 project: 范围；应使用本次任务已明确的项目。省略时使用命令工作目录；个人事务或没有明确项目时用 --personal。返回 scope 和 catalog，方法查询与任务分工沿用 scope；新方法的保存范围另按内容建议并确认。'};
      if (args[0].startsWith('judgment-')) return {...result, reference: 'references/judgments.md',
        semantics: '保存获准的任务判断；working 不等于因果已证明。反例由宿主判断，程序传播失效并阻止跳过依赖。',
        start: {taskId: '新任务编号', scope: 'personal', goal: '本次目标', nodes: [{id: 'cause', kind: 'hypothesis', claim: '待检验机制', status: 'working', basis: '具体来源与不确定性', dependsOn: []}]},
        challenge: {scope: 'personal', expectedRevision: 1, targets: ['cause'], evidence: {summary: '反例是什么', source: '来源定位'}},
        revise: 'judgment-set 使用 scope、expectedRevision、reason、nodes。每个节点传完整内容；dependsOn 为 [{id,revision}]，精确版本取最近回执。'};
      if (args[0] === 'route-save') return {...result,
        scope: 'JSON 的 scope 沿用 route-context 回执。新任务使用新 taskId；已有任务的排除项会保留。',
        example: {taskId: 'example-task', scope: 'project:实际项目路径', intent: '当前要完成什么', deliverable: '本轮交付',
          selected: [{id: '目录中的档案编号', version: '目录中的activeVersion', role: 'lead', responsibility: '本次负责的具体部分', why: '哪项条件会改变本次动作'}]},
        result: '成功返回 profiles，包含已校验精确版本的方法、边界和来源索引，可直接执行。无需再次 profile-get；只有追溯原始摘录或试用证据才读取完整档案。分工保存不新增方法、不启用草稿、不保存聊天。',
        exclusions: 'excludedIds 追加本任务排除项；解除已有排除须用户明确同意后提供 releaseExcludedIds 和 userApprovedExclusionChange:true。',
        ownership: '有选用方法时恰好一个 lead，可配不重复的 contributor 或 reviewer；最多三份。没选方法则直接完成，无需保存空分工。'};
      if (args[0] !== 'profile-intake') return result;
      const exampleVersion = await json(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'examples', 'profile-version.json'));
      return {...result,
        scope: '在 JSON 的 scope 字段填写建议保存的 personal 或已明确的 project: 范围，不是额外位置参数。跨项目可用的方法优先建议 personal；显示具体内容和范围后，由用户确认保存。',
        exampleSource: 'bab/assets/examples/profile-version.json',
        fields: {
          requestId: '非空字符串；同一提议重试沿用编号。示例编号需替换。',
          scope: '非空字符串；按方法内容建议范围，不直接照搬当前任务项目。预览不等于用户确认。',
          reason: '非空字符串；这项候选值得保存的具体理由。',
          profile: '新建对象：name、kind=method、purpose；aliases 可选。',
          target: '修订时替代 profile：id、version、approvalHash，取自目标版本回读。',
          version: '完整版本对象，结构见下方 example.version；不要直接把示例当成实际来源。',
          'version.boundaries': '字符串，不是数组。',
          'version.sources[].date': '必填字符串；真实时间未知时明确写“未知”，不要推测日期。',
          'version.evaluations': '未试用留空或 result=unrun，不得伪填 pass。'
        },
        example: {requestId: 'example-intake-preview', scope: 'personal',
          reason: exampleVersion.methods[0].reason,
          profile: {name: exampleVersion.methods[0].name, kind: 'method', purpose: exampleVersion.capabilities[0].task},
          version: exampleVersion},
        confirmation: '示例只用于预览，不包含授权。先调用 profile-intake 参数文件，展示返回的具体内容和范围。只有用户明确确认保存后，原参数才可增加 userApproved:true 和该预览的 approvalHash；内容变化须重新预览。保存仅得到草稿，不自动启用。'
      };
    }
  };
  if (!commands[command]) throw new Error(`未知命令：${command}`);
  return commands[command]();
}
