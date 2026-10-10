# 人物与方法档案

用户蒸馏的产物保存在自己的数据目录，不写入作者仓库。每人一个独立编号目录。显示名与别名可用于查询，重名时必须澄清，不能随便选人。

用户没有要求保存，但当前工作出现值得复用的方法时，进入 [主动发现](discovery.md)。先给具体提议，再由 profile-intake 按确认摘要保存；不先创建一个未获准的候选档案。

## 建档到使用

1. 先完成眼前任务并交付一张具体方法卡。用户只是讨论是否能保存时，不擅自建档；已经要求“整理后下次自动用”时，这覆盖约定范围内的草稿保存，不再问是否建草稿。确认启用仍应面对具体内容。
2. 用 `context` 确定当前范围，再 `profile-list 范围` 查看是否已有本次草稿，避免重复建人。没有时 `profile-create` 创建人物、自我或方法档案。只保存获准材料的索引与必要摘录。
3. 按 [版本参数](operations.md#人物档案) 和 [虚构示例](../assets/examples/profile-version.json) 准备数据，`profile-save` 保存草稿。保留来源、判断信号、行动、取舍、例外和证据状态。没有实际执行的试用写 unrun。回读返回的精确版本，确认 `record.json` 和 `SKILL.md` 真实存在；不能只交一份普通笔记便称已入库。
4. 用未参与提炼的新问题实际回答，再用一个不适用的边界问题实际回答。多分支方法中，从一个分支切换到另一个分支不等于拒用测试；至少一题必须超出整个方法的适用范围。记录真实输入、输出、评审者和结果。判断方法是否改变了具体选择，是否知道何时不用；AI 自评不能称为独立验证。修订和试用记录通过 `profile-save` 形成新版本，不覆盖旧文件、不把失败直接改成 pass。
5. `profile-get 编号 精确版本 范围` 的 `readiness` 给出下一步：run-trials 为缺少试用，revise-and-retest 为有失败，review-sources 为来源待复核，confirm-activation 为可以请用户确认。它与实际启用使用同一检查，但不能代替用户认可或独立质量验证。
6. 展示**具体方法、适用与禁用条件、新题和边界题的实际结果、版本、使用范围**。用户确认后，用此版本的 approvalHash 执行 `profile-activate`。内容有变先保存并重新展示；回退也使用明确版本与确认摘要。已有授权确实覆盖该具体版本时不重复询问。尚未确认就明确交付为草稿，并给出缺少的下一步，不停在架构说明。
7. 启用后 `route-catalog 范围` 核对该编号和 activeVersion，才告知“以后可以自然表达调用”。新会话按 [路由](routing.md) 查询、选用、保存分工、加载精确版本并完成新任务。启用成功不等于已经证明新会话自动调用成功，两者分别报告。

只借一招时使用 kind=method，不必先建立完整人物。已有专业 Skill 或方法文档是来源，复用其权威版本和定位，不复制整套规则形成第二份实现。草稿、测试失败和目录为空都不应中断用户眼前可完成的工作。

## 不点名也能用

读取 [自动选用与多人协作](routing.md)。通过轻量能力索引判断适用性，再加载选中的具体版本；不要把全部人物原始材料加载进每次对话。

用户主动点名可用 `profile-resolve` 查询别名。找不到就说明；同名返回候选；草稿不自动当成成熟方法使用。

## 纠正与成长

用户指出“他不会这样做”时，先修正当前输出。判断是资料误读、遗漏条件、时代变化还是单次例外。更新已有来源与方法形成新草稿，展示变化；不能一纠正就悄悄改当前版本。

档案的版本与套件版本独立。套件升级保留档案。人物新增材料不自动升级整套 Skill。

## 导出与删除

一般使用只需总入口，不必为每个人安装一套新的全局 Skill。需要跨应用或分享时，`profile-export` 先生成预览，再按确切摘要导出独立 `SKILL.md`。默认省略原始聊天、私人来源路径和身份资料。方法正文仍需人工审阅。

导出文件是当时版本的副本，之后不自动同步。忘记人物时用 `profile-delete` 清除全部本地版本及引用它的任务路由；明确说明不会删除原始材料或用户已复制出去的文件。

## 多媒体证据字段

已有纯文字档案继续可读，不迁移旧数据。新接入文件或混合资料时，`sources` 的每一项可附加 `material`。个人记忆的 `sources` 使用同一字段。以下是虚构读取回执，不是自动解析结果：

```json
{
  "id": "s1", "role": "subject", "ref": "synthetic://meeting/1#00:30-00:45",
  "date": "2026-01-01", "excerpt": "先看明天必须交的部分",
  "material": {
    "kind": "meeting", "title": "虚构会议节选", "extraction": "subtitles",
    "coverage": "partial", "locator": "00:30–00:45，说话人 A",
    "inspected": "字幕 00:00–02:00", "omitted": "没有音轨和画面",
    "uncertainty": "无法核对字幕误字", "identity": "A 为材料中标注的负责人，非用户",
    "origin": "synthetic-meeting-1"
  }
}
```

- kind：text / webpage / document / pdf / audio / video / image / book / meeting / chat。
- extraction：host-native / text / ocr / asr / subtitles / vision / mixed / unavailable。
- coverage：full / partial / unavailable。只有实际读取整个来源才写 full；节选以原来源为范围写 partial。
- title、locator、inspected、omitted、uncertainty、identity、origin 都是必填文字。没有缺口可写“无已知缺口”，身份不能确定就写“未知”。origin 标识同一次原始事件，避免多格式重复计证。

未读取的来源可以在当前材料清单中标 unavailable，但不能被方法或记忆引用为证据。后续补读时新增版本，不能直接覆盖旧回执。

## 导出来源与试用

`profile-export` 的 JSON 除 destination、skillName、displayName、scope 外，可含：

```json
{
  "sourceSummaries": [{"id":"s1","summary":"经审阅可分享的来源概括和定位","url":"https://example.org/public-source"}],
  "evaluationSummaries": [{"kind":"new","input":"可分享的新问题","output":"实际输出概括","reviewer":"AI 自评，非独立测试"}]
}
```

url 可省略；填写时使用可公开回看的 HTTPS 引用，不填私人路径或带凭据链接。来源编号必须属于原档案，测试类型也必须已经存在。同一类型有多个测试时，必须用 index 指向原 evaluations 数组的位置（从 0 开始）；仅提供 kind 会被拒绝，避免摘要错配。概括不能改写原结果或隐去失败。脚本会保留原测试 result，并将整份导出正文纳入确认摘要。

默认来源逐项标为未分享，测试仅列类型和已记录状态，注明接收方无法独立复核。需要可检查的分享副本时，主流程准备脱敏的来源、new 与 boundary 试用概括，并让用户审阅完整正文。不得自动复制私人原文。导出后的 SKILL.md 包含编号映射及测试说明，不再只有悬空来源编号。
