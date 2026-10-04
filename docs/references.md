# 参考来源与采用范围

这些项目用于研究机制。本仓库的代码和中文流程为本次原创实现，没有将上游完整入口或脚本复制进仓库。引用上游功能说明不代表上游为本项目背书。

| 来源 | 本次参考的机制 | 采用方式与差异 |
| --- | --- | --- |
| [mattpocock/skills](https://github.com/mattpocock/skills) | 当前 grilling 的问题依赖树、按前提推进、推荐答案、自查事实 | 上游会一轮询问全部可问节点；本套件为新手改成通常一题，保留依赖顺序和推荐理由 |
| [garrytan/gstack Office Hours](https://github.com/garrytan/gstack/tree/main/office-hours) | 分阶段诊断、结构化交接、上下文与维护 | 按需流程与明确交付；作者资源有显性说明与关闭开关 |
| [answer-me-with-html](https://github.com/QingYunA/answer-me-with-html) | 配置、安装、更新、可读结果 | 地址与运行数据分离；旧网页样稿不当正式页面 |
| [女娲](https://github.com/alchaincyf/nuwa-skill) | 来源调研、判断模型、边界、新问题验证 | 提炼方法并试用；不照搬名人数量或“高保真”评分结论 |
| [yourself-skill](https://github.com/notdog1998/yourself-skill) | 持续补充、对话纠正、版本存档与回滚 | 人物数据与套件代码分开；精确版本启用，候选与确认分开 |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | 插件化运行时、按需 Skill、子代理、事件和存储 | 可选宿主设计；未作为当前依赖 |

2026-10-05 本轮参考快照：

- mattpocock/skills：`24fe0ef7737efae15c87225755e9f6f5965e4888`
- garrytan/gstack：`2db0b3adc84b95be08d08bda4f9799ca7fa8665e`
- QingYunA/answer-me-with-html：`759effdb5222c278a5076d5dada035102396a084`
- alchaincyf/nuwa-skill：`fe0374687037c4cc51a65c1e0c145afe2981dc69`
- notdog1998/yourself-skill：`9deb1a87b1231fec85cadf2ef690fa49fef519ca`
- deepseek-ai/deepseek-harness：`5badb15009ae1756c3afe0ae0cef1faafc290ccc`

所有来源在本轮重新核对。answer-me-with-html 相比早些时候的快照新增了反馈表单与 PR 模板；已检查该增量，并在本套件反馈正文中补充经过预览的宿主、系统和安装方式字段。

0.1.2 发行复核再次获取六个仓库的当前提交，均仍为上方快照。逐项落地与验证见 [机制采用表](reference-adoption.md)。没有把“读过上游”当成“全部能力已经实现”。
