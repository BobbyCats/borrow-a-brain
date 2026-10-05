# 贡献指南

欢迎提交问题报告、文档修正和兼容性改进。修改行为前，请先阅读 [架构说明](docs/architecture.md)。

## 开发环境

- Node.js 22+。
- 构建独立程序时需要 Bun；CI 使用的版本见 [验证工作流](.github/workflows/verify.yml)。
- 运行内核使用 Node.js 标准库，无需安装 npm 依赖。

在仓库根目录运行：

```sh
npm test
npm run validate
git diff --check
```

`npm test` 运行程序测试。`npm run validate` 检查 Skill 元数据、版本一致性、文档链接和脚本语法。

如需验证安装、升级和卸载：

```sh
node scripts/smoke-installed.mjs
```

构建并验证独立程序：

```sh
npm run build
node scripts/smoke-installed.mjs --native
```

## 提交修改

- 说明具体问题、修改后的行为和验证方式。
- 使用虚构材料编写测试，不提交聊天记录、个人档案、凭据或反馈原文。
- 保持程序与用户数据分离。修改安装、更新或数据格式时，验证原有资料和规则是否保留。
- 路由与提问改动需要对话场景验证。程序测试通过不能替代实际 AI 应用中的试用。

## 报告问题

可通过 [GitHub Issues](https://github.com/BobbyCats/borrow-a-brain/issues) 报告可公开的问题。请提供版本、系统、AI 应用、复现步骤、预期结果和实际结果。提交前移除私人内容。

官网下载包还提供私有反馈入口，在对话中说“我想反馈一个问题”即可。

## 开发文档

- [本地命令](skills/bab/references/operations.md)
- [更新与反馈](skills/bab/references/maintenance.md)
- [作者服务配置](docs/author-operations.md)
- [场景测试](docs/evaluation.md)
- [验证记录](docs/verification.md)
- [已知限制与开发状态](docs/status.md)
