# DeepSeek Harness 对借个脑子的价值

核查日期：2026-10-05。官方仓库当前 master：`5badb15009ae1756c3afe0ae0cef1faafc290ccc`。本次只读研究，没有安装框架或调用模型 API。

## 推荐

保留通用 Skill 与独立人物数据内核。把 DeepSeek Harness（DSH）作为可选宿主适配，不作为第一版必装依赖。

当我们需要独立界面、每轮运行钩子、真正的子代理协作或更完整的执行追踪时，优先验证 DSH 的接口，再决定是否开发专用应用。

## 已确认的能力与对应价值

| 官方能力 | 对借个脑子的用途 | 仍由我们负责 |
| --- | --- | --- |
| Skill provider 的 list/get，按作用域合并目录 | 展示人物能力摘要，选中后加载对应版本 | 专长描述、适用性判断、别名冲突、资料权限 |
| Agent 生命周期事件与工具执行事件 | 在运行层接入路由、记录实际加载和失败位置 | 路由策略与用户可读的调用展示 |
| 子代理及 workflow 接口 | 将主写、补充、检查分给真正独立的任务 | 分工、来源范围、预算、分歧处理与质量验收 |
| 会话事件与持久化存储 | 任务恢复和问题复现 | 人物数据模型、证据、确认、遗忘与迁移政策 |
| 模型适配与可配置插件树 | 为不同运行方式组合能力 | 用户安装体验与兼容测试 |

来源：[Skill 接口](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/subsystems/skills.md)、[架构](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/architecture.md)、[子代理](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/subsystems/subagent.md)、[工作流](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/subsystems/workflow.md)、[存储](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/subsystems/storage.md)。

## 两个容易误解的地方

支持 Skills 不等于自动替我们判断哪个同事适合当前任务。DSH 提供能力目录和加载接口，方法选择仍需模型与我们的规则。

有存储或 Memory MCP 接口不等于自带可靠的“蒸馏自己”。官方说明第三方记忆配置默认关闭；数据库、模型、数据迁移等仍由对应提供方负责。[官方记忆接入说明](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/user/guide/mcp-memory.md)

## 可选适配应该怎么做

1. 第一层只接入现有五个 Skill，检查 DSH 的目录发现和加载。不改个人数据格式。
2. 第二层将人物能力索引作为一个 Skill provider；按当前项目返回已启用方法，get 时验证版本和范围。
3. 第三层用事件与子代理接口执行分工。能力不支持时明确降级为顺序执行，不能悄悄忽略限制。
4. 用同一组任务比较通用模式与 DSH 模式：路由选择、输出质量、失败恢复、用时、调用成本。没有结果前不宣称更强。

以上是适配设计，当前未实现 DSH 插件。它仍处于开发者预览，官方明确提示未来会有破坏兼容性的变更。[官方 README](https://github.com/deepseek-ai/deepseek-harness)
