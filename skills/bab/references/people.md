# 人物与方法档案

用户蒸馏的产物保存在自己的数据目录，不写入作者仓库。每人一个独立编号目录。显示名与别名可用于查询，重名时必须澄清，不能随便选人。

## 建档到使用

1. `profile-create` 创建档案。确认材料用途、允许使用的范围、希望学会什么。可建人物、自我或不挂人名的方法档案。
2. 提炼方法时保留来源、判断信号、行动、取舍、例外和证据状态。原始材料默认只留索引和必要摘录，不复制整个聊天库。
3. `profile-save` 形成不可直接覆盖的版本。每个版本包含 `record.json` 和可读取的 `SKILL.md`。新版本先是草稿。
4. 用未参与提炼的新问题测试，再用一个不适用的边界问题测试。记录实际输出、评审者和结果。AI 自评不能称为独立验证。
5. 向用户展示方法、边界和验证记录。确认后 `profile-activate` 切换当前版本。回到旧版本也使用明确的版本和确认摘要，不能靠前缀猜版本。
6. 后续自然表达或自动路由选中档案时，读取当前版本的 `SKILL.md`。公开的是本次引用的方法，不冒充人物本人在回答。

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
