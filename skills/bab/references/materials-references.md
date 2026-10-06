# 素材接入参考

核查日期：2026-10-06。以下为官方文档和项目原始说明。采用的是机制；未复制上游代码，没有把这些项目作为本套件强制依赖。版本和支持格式可能变化，实际使用前仍检查宿主能力。

| 项目 | 官方依据 | 本套件采用 | 未作出的承诺 |
| --- | --- | --- | --- |
| NotebookLM（当前帮助页标题为 Gemini Notebook） | [来源类型与限制](https://support.google.com/gemininotebook/answer/16215270?hl=en) | 选择本次来源；区分网页文字、视频字幕和音频转写；披露读取范围 | 导入视频链接不等于理解画面；来源上传不等于逐条核验 |
| Microsoft MarkItDown | [官方仓库](https://github.com/microsoft/markitdown) | 宿主已有转换能力时，先把办公材料变成可读内容，再做方法提炼 | 转成 Markdown 不是语义验证；不把可选扩展当作基础能力 |
| Docling | [文档模型](https://docling-project.github.io/docling/concepts/docling_document/) · [分块](https://docling-project.github.io/docling/concepts/chunking/) | 保留页码、区域、上下文与来源定位；长材料记录实际覆盖 | 不为本套件引入整套模型依赖，不声称复杂版面全部保真 |
| Fabric | [视频处理工作流](https://github.com/danielmiessler/Fabric/blob/main/docs/YouTube-Processing.md) | 提取与任务提示分开；带时间点的字幕可回看 | 不照搬固定数量的观点、习惯和金句；证据不足时允许少产出或不提炼 |

设计判断：先复用宿主能力，再维护统一证据回执。相比只增加“支持 PDF/视频”的宣传，这能让用户检查到底读到了什么。外部工具无法使用时仍可接收相关片段，不需要本套件自建上传、转码或转写服务。
