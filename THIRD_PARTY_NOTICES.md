# 来源与运行时说明

本套件原创指令、脚本和文档按包内 LICENSE 的 MIT 条款提供。用户自行整理的人物材料、个人记忆和反馈不在此授权范围内。

设计研究参考 mattpocock/skills、garrytan/gstack、QingYunA/answer-me-with-html、alchaincyf/nuwa-skill、notdog1998/yourself-skill 和 deepseek-ai/deepseek-harness。没有复制这些项目的完整 Skill、脚本、品牌素材或人物语料；它们不为本套件背书。机制采用说明见仓库 docs/references.md。

独立程序由 Bun 1.4.2 构建，包含 Bun 及其依赖运行时。它们沿用各自许可证，详见 [Bun 原始说明](third_party/BUN-LICENSE.md)。通用源码包不包含运行时二进制。

- 对应 Bun 源码：[bun-v1.4.2](https://github.com/oven-sh/bun/tree/bun-v1.4.2)。
- Bun 使用的 JavaScriptCore / WebKit、重新构建和链接方法，见上方原始许可证说明。
- 本包的启动器源代码在 `runtime.mjs`。应用源码在 `skills/bab/scripts/`。
- 可以使用修改后的兼容 Bun 构建启动器：`bun build --compile --minify runtime.mjs --outfile skills/bab/bin/bab`。Windows 输出文件名为 `bab.exe`。无需联系作者取得应用源代码；它随每个安装包提供。

程序运行时动态读取 `skills/bab/scripts/`，人物资料与记忆另存。发行更新验证 Ed25519 签名；它不代表操作系统代码签名或模型回答质量认证。
