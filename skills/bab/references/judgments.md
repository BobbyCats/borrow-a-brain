# 判断状态与依赖

用于需要持续推导、有后续决定依赖的任务。短问答不建图。用户已要求保存、持续跟进或实施该任务时，在其授权范围内记录最小判断；否则先在当前对话推导，获得保存授权后再持久化。它是任务工作状态，不是用户画像或可自动启用的方法。

沿用总入口的运行入口。`scope` 取 route-context 回执，任务编号沿用当前任务；新会话先 `judgment-list "范围"`，再 `judgment-load "任务编号" "范围"`。没有记录不能假装恢复成功。

## 首次记录

把 JSON 放入私有临时文件，执行 `judgment-start "参数文件"`：

```json
{
  "taskId": "示例任务编号",
  "scope": "personal",
  "goal": "降低全链路报废，不能把损失转给下游",
  "nodes": [
    {"id":"cause","kind":"hypothesis","claim":"大批次造成积压","status":"working","basis":"暂定机制；还需与门店周转解释比较","dependsOn":[]},
    {"id":"trial","kind":"decision","claim":"先试小批次","status":"working","basis":"可逆试验，不是原因已证明","dependsOn":[{"id":"cause","revision":1}]},
    {"id":"budget","kind":"decision","claim":"试验有效后再决定扩容投入","status":"open","basis":"等待全链路结果","dependsOn":[{"id":"trial","revision":1}]}
  ]
}
```

节点类型为 observation（观察）、hypothesis（解释）、decision（建议或决定）。`basis` 写具体来源、理由及不确定性，不能把用户倾向伪装成独立证据。竞争解释分别记录，缺乏区分证据时保持 open。

状态：open 尚未决定；working 当前暂定；supported 材料支持的观察或解释；rejected 已排除；needs-review 前提改变待复核。决定只能暂定或拒绝，不能标 supported 来冒充因果已证明。程序不代替模型判断事实真伪。决定节点只依赖真正会改变该决定的前提；单纯背景留在 basis，避免无关信息触发全图失效。

## 反例与变更

新材料实际挑战已有判断时，**先登记反例，再重新推导**：

```json
{"scope":"personal","expectedRevision":1,"targets":["cause"],"evidence":{"summary":"小批次后工厂损失下降，但门店损失上升，总报废未降","source":"用户提供的试验台账，第2轮"}}
```

执行 `judgment-challenge "任务编号" "参数文件"`。目标节点及所有下游自动变为 needs-review，旧建议从 recommendations 移除。用户只是重复偏好时，不伪造“新证据”。是否构成反例由模型依据内容判断。

回执 `frontier.ready` 是可以先处理的未决判断；`blocked` 是前提还未解决的后续判断。按证据复核 ready，别把所有节点轮番问用户。自己可核实的事实直接核实；需要用户取舍时只问影响当前建议的一点。

执行 `judgment-set "任务编号" "参数文件"` 更新：

```json
{"scope":"personal","expectedRevision":2,"reason":"反例推翻原机制；先复核原因，再改试验与预算","nodes":[{"id":"cause","kind":"hypothesis","claim":"仅缩小工厂批次能降低全链路报废","status":"rejected","basis":"试验台账显示损失只是转移","dependsOn":[]}]}
```

每次写入必须使用最近回执的任务 revision。更新节点传完整内容；依赖使用最近回执中的节点 revision。没有变化的节点不要重写。批量更新可用，但每个已解决节点必须引用已审阅的最新前提。程序拒绝跳过未复核前提或沿用旧版本；并发修改失败后重新载入。

继续处理受影响的建议与投入。恢复原建议也必须解释反例为何不改变它；不要只加风险脚注。恢复时保留真实依赖，不能为了绕过待复核状态删除依赖。真正改成独立方案时可以换依赖，并说明理由。新目标与旧目标不兼容时建立新任务，保留旧任务依据。

对用户交付：原建议哪里失效、现在建议什么、哪些后续决定仍暂停。无需展示整张图或命令。未完成复核不能说整体结案。反例记录、旧判断和变更原因均保留在 events；`judgment-load` 可导出完整 JSON，`judgment-delete "编号" "范围"` 删除单项；`data-clear --confirmed` 包含全部判断状态。导出副本另行管理。
