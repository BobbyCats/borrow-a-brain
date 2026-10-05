# 使用指南

借个脑子需要在能操作本地文件、执行命令的 Codex 或 Claude Code 中安装。其他应用需要自行核对 Skill 支持。如果你只使用网页聊天，可以粘贴 Skill 指令和材料体验提问与分析；本地记忆和历史读取需要本地应用支持。

## 下载安装

从 [官网](https://jclab.top/tools/borrow-a-brain/) 下载并解压安装包。不需要 GitHub 账号。

| 你的设备 | 安装包 |
| --- | --- |
| Apple 芯片 Mac | `borrow-a-brain-mac-arm64.zip` |
| Intel / AMD 64 位 Windows | `borrow-a-brain-windows-x64.zip` |
| x64 Linux | `borrow-a-brain-linux-x64.zip` |
| 其他架构，或已安装 Node.js 22+ | `borrow-a-brain-source.zip` |

前三种安装包自带运行程序。源码包需要 Node.js 22+，不需要安装 npm 依赖。

在 Codex 或 Claude Code 中提供解压后的文件夹，输入：

> 帮我安装这个文件夹里的“借个脑子”。先检查环境，告诉我会装在哪里、改哪些文件，保留我原来的配置。装好后带我试一次。

安装默认用于你选定的项目。AI 会展示 Skill 目录、规则文件、数据位置和文件冲突，确认后再执行。检查环境不会读取聊天记录。

装好后，在该项目中开启新会话，输入：

> 我有件事拿不定主意，你帮我捋一捋。

回复中应显示实际调用的 Skill。若没有显示，按下方“常见问题”检查。

## 命令行安装

以下 `setup` 命令适用于 **0.1.2 及以上版本**。在解压目录或仓库根目录运行，将示例路径替换为一个已存在的项目目录。

如果下载的是 0.1.1，请让 AI 读取包内 `skills/bab/references/operations.md`，按其中的 `install` 流程安装。

源码包使用 Node.js：

```sh
node skills/bab/scripts/run.mjs setup codex "/absolute/path/to/project"
```

命令默认只生成安装预览。检查目录和规则后，加上 `--apply` 执行：

```sh
node skills/bab/scripts/run.mjs setup codex "/absolute/path/to/project" --apply
```

Claude Code 用户将 `codex` 换成 `claude`。Windows 用户将项目路径换为 Windows 绝对路径，例如 `C:\Users\YourName\Documents\my-project`。

独立程序包使用相同参数，仅替换命令入口：

| 平台 | 命令入口 |
| --- | --- |
| macOS / Linux | `./skills/bab/bin/bab` |
| Windows PowerShell | `.\skills\bab\bin\bab.exe` |

安装位置如下：

| 应用 | 项目内 Skill 目录 | 项目内规则文件 |
| --- | --- | --- |
| Codex | `.agents/skills/` | `AGENTS.md` |
| Claude Code | `.claude/skills/` | `CLAUDE.md` |

要在所有项目中使用，将项目路径替换为 `--user`。这会改为用户级安装，执行前请核对预览。非标准安装路径及其他命令见 [本地操作](../skills/bab/references/operations.md)。

## 第一次使用

[三次上手练习](../skills/bab/assets/getting-started.md) 提供完整的示例材料，分别体验提问、提炼方法和个人偏好。0.1.2 及以上安装包附带这些练习；旧版用户可阅读 [仓库中的练习](https://github.com/BobbyCats/borrow-a-brain/blob/main/skills/bab/assets/getting-started.md)。也可以直接拿一件正在处理的事试用：

> 我准备给客户写一封延期说明，但不知道怎么开头。你先帮我理清要说什么。

安装包没有预装真人档案。你提供材料、试用并确认启用后，可以说“用这个方法再看一份新方案”。不点名时，AI 也会按任务选择已启用的方法。简单任务可以直接完成。

读取历史不是使用前提。需要分析旧对话时，再确认读取范围；需要保存偏好时，再确认具体条目。

## 更新与反馈

输入“检查借个脑子有没有更新”。配置了更新源的安装会在使用时定期检查版本，发现更新后展示变化，经你同意再安装。人物档案、个人记忆和原有规则会保留。

输入“我想反馈一个问题”。AI 会整理问题、预期结果和复现步骤，展示正文与接收地址，确认后发送。源码仓库默认不配置作者服务；官网下载包包含更新和反馈配置。GitHub 自动生成的 Source code 压缩包是仓库快照，与作者提供的通用源码安装包不同。

## 数据管理

你可以直接提出这些要求：

- “你记了我什么？”——查看已保存的记忆。
- “这条只用于工作报告。”——限定偏好的适用范围。
- “这次别用老王的方法。”——跳过指定方法。
- “把这条忘掉。”——删除指定记忆及其修订记录。

数据保存在本机，和安装目录分开。实际位置可通过 `doctor` 查看。发给 AI 的材料仍按所用应用的数据处理规则处理。删除本套件记忆不会删除 AI 应用中的原聊天、已发送的反馈或已导出的副本。

## 常见问题

**新会话没有调用 Skill。**

确认新会话位于安装时选择的项目。让 AI 检查 Skill 目录、同名冲突和规则加载情况，再按应用要求刷新或开启新会话。文件安装成功不代表应用已经加载。

**程序打不开。**

核对系统和处理器架构。不匹配时使用 Node.js 源码包。独立程序尚未完成 Apple 公证或 Windows 代码签名；不要通过关闭系统保护来安装。

**更新提示“本地有修改”。**

让 AI 显示差异，保留修改后再处理冲突。不要通过删除个人资料来重装。

**如何卸载？**

让 AI 使用原下载包执行 `uninstall`，目标为实际安装的 Skill 目录。卸载会移除本套件代码和规则，默认保留个人资料。需要清除资料时，请单独提出。Windows 必须使用下载包中的程序卸载，不能让已安装的程序删除自身。
