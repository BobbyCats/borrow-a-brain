// CLI-only validation. Library callers and existing stored scopes stay compatible.
const signatures = {};
const add = (names, min, max, usage, scopes = [], flags = []) => {
  for (const name of names.split(' ')) signatures[name] = {min, max, usage, scopes, flags};
};
add('doctor config-get material-cleanup', 0, 0, '');
add('help', 0, 1, '[命令]');
add('context', 0, 1, '[项目路径]');
add('config-set material-import profile-create profile-intake history-grant memory-add install feedback-draft update-apply', 1, 1, '参数文件');
add('material-list', 0, 3, '[范围] [关键词] [类型]', [0]);
add('material-get', 1, 3, '素材编号 [范围] [版本]', [1]);
add('material-delete profile-save profile-export route-checkpoint memory-replace correction', 2, 2, '编号 参数文件');
add('profile-list route-catalog memory-list', 0, 1, '[范围]', [0]);
add('profile-get', 1, 3, '档案编号 [版本或 active] [范围]', [2]);
add('profile-resolve', 1, 2, '名称或别名 [范围]', [1]);
add('profile-activate', 3, 4, '档案编号 精确版本 确认摘要 [范围]', [3]);
add('profile-delete history-revoke memory-forget feedback-status feedback-delete', 1, 1, '编号');
add('route-save resource', 1, 1, '参数文件');
add('route-load', 1, 2, '任务编号 [范围]', [1]);
add('route-list', 0, 2, '[范围] [关键词]', [0]);
add('history-read', 1, 2, '授权编号 [条数]');
add('memory-query', 1, 2, '关键词 [范围]', [1]);
add('setup', 1, 2, 'codex|claude 项目路径 [--apply]；用户级用 --user 代替项目路径', [], ['--apply', '--user']);
add('uninstall', 1, 1, 'Skill 安装目录');
add('feedback-send', 2, 2, '报告编号 确认摘要');
add('update-check', 2, 2, '更新配置文件 当前版本 [--force]', [], ['--force']);
add('data-clear', 1, 1, '--confirmed');

export function usageFor(command) {
  const spec = signatures[command];
  if (!spec) throw new Error(`未知命令：${command}`);
  return `${command}${spec.usage ? ` ${spec.usage}` : ''}`;
}

export function parseArguments(command, args) {
  const spec = signatures[command];
  const usage = usageFor(command);
  const options = [], positional = [];
  for (const arg of args) {
    if (spec.flags.includes(arg)) {
      if (options.includes(arg)) throw new Error(`选项重复：${arg}。用法：${usage}`);
      options.push(arg);
    } else if (arg.startsWith('--') && !(command === 'data-clear' && arg === '--confirmed')) {
      throw new Error(`不支持选项 ${arg}。用法：${usage}。范围使用位置参数，不使用 --scope。`);
    } else positional.push(arg);
  }
  if (positional.length < spec.min || positional.length > spec.max) throw new Error(`参数数量不正确。用法：${usage}`);
  for (const index of spec.scopes) {
    const scope = positional[index];
    if (scope !== undefined && (scope.length > 500 || /[\r\n\0]/u.test(scope) || !/^(?:personal|project:.+)$/u.test(scope))) {
      throw new Error(`范围必须是 personal 或 context 返回的 project: 范围。用法：${usage}`);
    }
  }
  return [...positional, ...options];
}
