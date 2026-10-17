// WorkBuddy documents CodeBuddy-compatible configuration. Do not guess a
// ~/.workbuddy/AGENTS.md contract from the application's private data directory.
export const HOSTS = Object.freeze({
  codex: {skills: '.agents/skills', rules: {project: 'AGENTS.md', user: '.codex/AGENTS.md'}, discovery: {legacySkills: '.codex/skills', history: '.codex/sessions'}, historyAdapter: 'codex'},
  claude: {skills: '.claude/skills', rules: {project: 'CLAUDE.md', user: '.claude/CLAUDE.md'}, discovery: {history: '.claude/projects'}, historyAdapter: 'claude'},
  workbuddy: {skills: '.codebuddy/skills', rules: {project: '.codebuddy/rules/borrow-a-brain.md', user: '.codebuddy/rules/borrow-a-brain.md'}, discovery: {nativeSkills: '.workbuddy/skills'}, historyAdapter: 'export',
    note: '使用 WorkBuddy 官方支持的 .codebuddy 兼容配置；同范围的 CodeBuddy 也可能加载。安装不证明宿主已加载，须在新任务实际试用。原生历史读取尚未支持，可提供选定材料或授权读取导出的 JSON。'}
});
export const hostNames = Object.keys(HOSTS);
