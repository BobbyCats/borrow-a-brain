# 本地操作

以下命令由 Agent 执行，不要求普通用户填写 JSON。先展示将做的变更；现有授权覆盖的动作不反复询问。文件参数应放在私有临时目录，不进入项目 Git。

## 运行入口

- 源码仓库：`node /绝对路径/borrow-a-brain/bin/bab.mjs <命令> ...`
- 通用源码安装包或安装后的源码：`node /绝对路径/skills/bab/scripts/run.mjs <命令> ...`
- 独立包：`/绝对路径/skills/bab/bin/bab <命令> ...`；Windows 文件名 `bab.exe`。只有包中实际存在程序且平台已验证时使用。

`doctor` 查看环境，只探测已知宿主目录是否存在。`help` 列出命令，`help 命令名` 查看该命令参数。脚本输出 JSON；退出码非零代表失败，不能当作已完成或空目录。未知选项、额外参数和非法范围会报错。

`context 项目路径` 返回规范化的真实路径及任务 scope。后续命令沿用返回值，避免同一个目录因链接写法不同查不到任务。范围是位置参数，例如 `route-catalog 'project:/实际项目路径'`，不使用 `--scope`。无项目时用 personal。`cli.mjs` 是模块，不是可执行入口。

数据位置由 `BAB_HOME` 覆盖；默认 macOS 是用户 Library/Application Support/borrow-a-brain，Windows 是 LOCALAPPDATA/borrow-a-brain，Linux 是 XDG_DATA_HOME/borrow-a-brain 或 ~/.local/share/borrow-a-brain。

## 安装

Codex 或 Claude Code 可直接运行 `setup codex 项目绝对路径` 或 `setup claude 项目绝对路径`。默认只预览。结果包含五个 Skill、规则文件路径、完整新增规则和数据目录，并在预览时检查已存在文件的冲突。确认后加 `--apply`。用户明确要求所有项目可用时，用 `--user` 代替项目路径。

Codex 项目目录使用 `.agents/skills` 与 `AGENTS.md`，Claude Code 使用 `.claude/skills` 与 `CLAUDE.md`。下方 JSON 形式供非标准路径或已登记安装使用；升级必须保留原有路径，不能创建第二份安装替代第一份。

准备 JSON：`source` 为下载包的 skills 目录绝对路径，`skillsDir` 为所选宿主的 Skill 目录，`rulesFile` 为宿主实际支持的规则文件，`apply` 初次为 false。版本从包内自动读取；若传 `version`，必须与包一致。项目安装还传 `scopeRoot` 为用户选定的项目目录，setup 会自动填写。预览中的 `resolvedPaths` 是真实位置；目录链接越过所选范围时停止，不能把共享目录当作项目目录。

运行 `install 参数文件` 得到预览。用户同意位置与自动路由规则后，将 `apply` 改为 true 并执行。安装保留其他规则和同名外来 Skill；如果冲突，先展示差异。宿主是否加载要通过新会话实际试用确认。

Codex 与 Claude Code 的目录仅可作为 doctor 返回的候选。项目级规则优先用于首次试用，避免未经明确授权扩大到所有项目。其他宿主须查其官方安装约定。

`uninstall skillsDir` 移除本套件登记的代码和路由块，保留人物档案与记忆；本地修改会阻止覆盖或卸载，先让用户决定如何保留。

Windows 独立程序卸载时，使用原下载包里的 bab.exe，目标参数仍是安装目录。Windows 不能删除正在运行的自身程序；检测到时会停止并提示，不会假报卸载完成。

## 历史记录

`history-grant 参数文件` 输入示例：

```json
{"adapter":"codex","root":"/用户同意的记录目录","purpose":"查找用户反复纠正的写作偏好","days":1,"userApproved":true}
```

`userApproved` 只能在用户已同意后填写。有效期 1–30 天。整个 root 都是授权读取边界；可选 `project` 是返回结果过滤条件，不是目录访问权限。需要严格项目隔离时，选择项目导出目录，或使用宿主提供的按会话读取 API。

`history-read 授权编号 10`，单次最多 20 个。按文件修改时间选取近会话；这不等于平台 UI 精确的最近排序。跳过子代理、归档目录、链接和超过 2 MiB 的文件，披露遗漏。回执的 excluded 按原因计数；目录不遍历内容，只按目录计数。uninspectedCandidates 表示因条数限制未检查的候选文件，不能当作可用会话总数。存在排除、损坏、限额或扫描截断时 completeness 为 partial。支持 Codex JSONL、Claude JSONL，以及消息数组或 `{messages:[...]}` 的 JSON 导出；其他格式先人工确认导出方法。

`history-revoke 授权编号` 立即撤销后续读取。原始聊天不复制进状态文件。

## 记忆

`memory-add 参数文件` 示例：

```json
{"kind":"preference","status":"candidate","statement":"工作报告先给结论","scope":"personal","conditions":"正式工作报告","exceptions":"自由聊天不强制","sources":[{"role":"user","ref":"会话编号#消息定位","excerpt":"必要摘录"}],"outcome":"尚未验证"}
```

sources 可附带 [多媒体证据字段](people.md#多媒体证据字段)，保存与查询保留原始定位、身份和读取覆盖。

类型为 preference / decision / method / observation。确认状态 `confirmed` 需要用户证据和 `userConfirmed:true`。不能把助手曾建议的做法直接记成用户习惯。

- `memory-list 范围`：查看条目和证据，默认 personal。
- `memory-query '关键词' 范围`：默认最多 5 条已确认规则，属于关键词筛选。
- `memory-replace 旧编号 参数文件`：新确认规则替代旧规则。
- `memory-forget 编号`：清除该规则整个修订链。
- `data-clear --confirmed`：用户确认后清除全部派生记忆、人物档案、素材库、历史授权、反馈草稿和任务分工；保留安装回执。未删除宿主聊天或服务端反馈。清除以一次加锁提交为界，提交之前的数据统一重置，之后用户新建的数据不在清除范围。文件清理失败会报错，不宣称彻底删除。

## 素材库

素材导入、覆盖、检索、删除和失败清理见 [专属素材库](library.md)。material-import / material-delete 默认预览，明确入库或删除授权后核对预览并按摘要应用。当前副本的 id、revision、sha256 进入来源证据，旧版本更新后必须复核派生结论。

## 人物档案

按 [档案流程](people.md) 使用以下命令：

| 命令 | 参数与结果 |
| --- | --- |
| profile-create | JSON 包含 name、aliases、kind、purpose、scope、userApproved |
| profile-save | 档案 ID + JSON，产生新版本和 approvalHash |
| profile-get | 档案 ID + 版本或 active + 范围；读取内容与验证记录 |
| profile-activate | 档案 ID + 精确版本 + approvalHash + 范围；用户确认后启用或回退 |
| profile-list | 范围；列轻量档案索引 |
| profile-resolve | 名称或别名 + 范围；有歧义时返回候选 |
| profile-export | 档案 ID + JSON；先预览，确认摘要一致才写入新目录 |
| profile-delete | 档案 ID；清除本套件内所有版本和对应路由记录 |

版本 JSON 字段：`change`、`boundaries`、`sources[{id,role,ref,date,excerpt}]`、`methods[{name,trigger,action,reason,limits,evidence,sourceIds}]`、`capabilities[{task,when,avoid}]`、`evaluations[{kind,input,output,result,reviewer}]`。包内 [版本参数示例](../assets/examples/profile-version.json) 是虚构草稿，测试状态为 unrun；不得直接改成 pass 充当实测。

profile-save 与 profile-get 返回 `readiness`，包含 readyToActivate、blockers、missingTrials、nextAction。具体下一步见 [建档到使用](people.md#建档到使用)。旧版本内容及生成的 SKILL.md 保持不变；readiness 由现有记录即时计算，不迁移用户数据。

`evidence` 为 observed 或 inferred；`role` 区分 user、subject、assistant、document、observer；验证 kind 为 known、new、boundary，result 为 pass、fail、unrun。来源缺失和测试失败不能启用。多媒体来源可附 material 回执，见 [证据字段](people.md#多媒体证据字段)。导出可分享引用和试用摘要见 [导出来源与试用](people.md#导出来源与试用)。

## 主动收录

`profile-intake 参数文件` 将只读提议与确认保存放在同一个入口。语义发现与查重由 [发现流程](discovery.md) 负责，脚本不靠词频猜用户想法。

参数：

- `requestId`：该项提议的稳定编号，重试沿用；内容发生实质变化后用新编号。
- `scope`：显式提供 personal 或 context 返回的 project: 范围；没有默认全局范围。
- `reason`：向用户展示的具体推荐理由。
- `profile`：新建时的 name、aliases、kind=method、purpose。范围只取上层 scope。
- `version`：上一节的完整版本对象。未试用的 evaluations 留空或标 unrun，不能为了保存填 pass。
- `target`：修订已有档案时，替代 profile；包括 id、version、approvalHash，后两项来自最新草稿或最新版本的回读。目标必须属于此次确认的确切范围。

不传 `approvalHash` 时只返回 preview、content、readiness 和 approvalHash，不创建数据目录或档案。content 中的用途、方法动作、来源、边界、范围、目标和推荐理由都属于本次确认内容；面向用户的卡片不得隐去会改变意思的部分。

用户确认保存后，原参数增加 `userApproved:true` 和该预览的 `approvalHash`，再执行同一命令。摘要匹配才能写入；修改动作、范围、理由或目标后旧摘要失效。元数据中保存提议编号和确认摘要，重复或并发提交返回同一版本。相同编号配不同内容报错。新建和第一版保存共用同一写锁；修订时若目标出现新版本则停止，先回读并展示新差异。

返回 draft 后按原试用与启用流程继续。该命令不会修改 activeVersion。“确认保存”不等于“试用通过”，也不等于“确认启用”。没有匹配授权时，不能由 Agent 自行填写 userApproved。摘要防止错配，不能证明真人授权，宿主仍负责核对用户原话。

查重需看当前范围的 `profile-list`，不只看已启用目录。已保存后再次调用可返回 already-saved；用返回的 id、version 和 scope 回读验证，不重新建档。提议元数据随其档案删除或 data-clear 清除，没有独立的未确认候选库。

## 自动分工

`route-catalog 范围` 列出已启用方法的用途与边界。模型理解任务后准备 JSON：

```json
{"taskId":"当前任务稳定编号","scope":"personal","intent":"向客户解释延期","deliverable":"一段可以直接使用的话","selected":[{"id":"实际档案ID","role":"lead","responsibility":"组织原因和补救措施","why":"该档案有对应的沟通方法"}],"excludedIds":[]}
```

`role` 只允许 lead（主责）、contributor（补充）、reviewer（检查），多人时恰好一个 lead。`route-save 参数文件` 检查唯一主责、最多 3 人、档案范围和版本；`route-load 任务编号 范围` 恢复固定版本。excludedIds 同任务只增不隐式清除。用户明确解除时传 releaseExcludedIds 与 userApprovedExclusionChange:true；list/load 都带回排除项。选择 0 人是正常情况。不得只写计划就声称各专家已参与。

`route-list 范围 [关键词]` 在当前范围查最近 10 项任务，无原始资料。用户说“接着上次那个”时由此找到 taskId。`route-checkpoint 任务编号 参数文件` 保存获准的最小进度，格式为 `{"scope":"personal","status":"active","summary":"已经确认的结果","next":"下次继续什么"}`；完成状态用 done。它不取代任务交付，也不授权任何外部操作。

重复保存相同分工保留 checkpoint。目标、交付或方法分工改变后，checkpoint.needsReview 为 true，route-load 返回 needs-review。先核对旧摘要与下一步是否仍适用，再用 route-checkpoint 写入核实后的进度，解除待复核状态。不能直接把旧进度当作当前结论。

## 故障

状态损坏不自动重置。写锁超过 5 秒会报错，先检查是否有运行中的命令，不能按文件年龄直接删除锁。程序崩溃后的残留 staging、backup 或 delete 目录必须检查再处理，不把未完成清理说成彻底删除。
