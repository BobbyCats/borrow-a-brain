# 作者端运行与分发

本文说明反馈服务、签名更新和安装包的维护方式。部署目录、服务账号和私密配置由部署者自行管理，不进入源码或安装包。

## 公开入口

- [使用说明与下载](https://jclab.top/tools/borrow-a-brain/)
- [版本说明](https://jclab.top/tools/borrow-a-brain/updates/)
- [发行清单](https://jclab.top/downloads/borrow-a-brain/releases.json)
- [签名更新](https://jclab.top/downloads/borrow-a-brain/latest.json)

当前可下载版本以发行清单为准。源码仓库的默认配置不连接作者服务；官方安装包在组装时注入公开服务地址与可信公钥。

## 反馈服务

完整服务入口为 `server/console.mjs`。它在 `server/feedback.mjs` 的收件协议上提供管理会话、状态处理和审计记录。服务需要 Node.js 22+。

在仓库根目录配置以下环境变量后运行 `node server/console.mjs`：

| 环境变量 | 用途 |
| --- | --- |
| `BAB_INBOX_HOME` | 反馈数据目录，放在源码和静态网站目录之外 |
| `BAB_ADMIN_TOKEN` | 管理 API 的长期令牌 |
| `BAB_LOGIN_HASH` | 管理登录口令的 scrypt 校验值 |
| `BAB_ORIGIN` | 管理界面的可信来源 |
| `BAB_ADMIN_HTML` | 管理界面 HTML 文件路径 |
| `BAB_RELEASES_FILE` | 已发布版本清单文件路径 |
| `PORT` | 可选监听端口，默认 8791 |
| `BAB_TRUST_PROXY` | 仅在可信代理覆盖 `X-Real-IP` 时设为 `1` |
| `BAB_LOCAL` | 仅隔离本机联调可设为 `1`，生产环境不启用 |

前六项为必填。服务监听本机回环地址，由部署者配置 HTTPS 反向代理。管理界面的 HTML 和反向代理配置不随用户安装包提供。生产部署应使用专用低权限账号，并将程序、配置和反馈数据分开保存。

长期管理员令牌、登录哈希和私密环境文件不得放入 Git、静态网页、安装包或版本清单。API 日志不记录反馈正文与凭据。

## 接口与状态

以下是服务内部路径；公开访问前缀由反向代理配置决定。

| 接口 | 权限与作用 |
| --- | --- |
| `POST /v1/feedback` | 结构化收件，检查大小、来源限频和幂等编号 |
| `GET /v1/feedback/:id` | 使用独立回执令牌查询状态、修复版本和给用户的进展 |
| `POST /session` | 同源登录、scrypt 口令校验与登录限频 |
| `GET /session` | 当前管理会话状态与 CSRF 凭据 |
| `DELETE /session` | 同源与 CSRF 校验后退出 |
| `GET /admin/feedback` | 管理会话或管理员 Bearer 鉴权；不返回报告查询令牌 |
| `PATCH /admin/feedback/:id` | 管理鉴权、修订号冲突检查、状态与发布版本检查，并记录审计 |

处理状态为 `received / working / waiting / resolved / closed`。标记 `resolved` 必须指定已发布版本；标记 `closed` 必须填写原因。内部备注与给用户的进展分开保存。作者标记解决不代表用户已验收。

管理会话使用 `HttpOnly`、`Secure`、`SameSite=Strict` Cookie，有效期为 8 小时。服务重启后需要重新登录。

`server/feedback.mjs` 可单独用于协议测试，默认端口为 8787。它不提供完整管理会话和界面。正式服务使用 `server/console.mjs`。

## 数据维护

部署者应定期运行 `node server/maintenance.mjs`，并为该进程设置 `BAB_INBOX_HOME`。

当前维护规则是：结案满 90 天清理报告正文、备注和回复；生成私有 JSON 备份，并清理达到 7 天的旧备份。程序更新和网站回滚不得覆盖反馈数据。

## 配置与域名迁移

源码中的 `skills/bab/assets/author.json` 保持空地址默认值。正式安装包在组装时注入官网、反馈地址、更新地址与可信公钥。签名私钥保存在仓库外，安装包只包含公钥。

用户通过 `config-set` 保存的本地配置优先于随包配置。升级不能默默覆盖这些选择。

反馈发送、查询和更新客户端使用 `redirect: 'error'`，因此域名迁移不能只依靠 HTTP 重定向。旧域 API 应透明代理同一后端；旧更新路径应直接返回签名包，至少保留一个旧客户端可达入口。迁移时分别验证历史草稿、确认摘要、回执和本地覆盖配置。

地址变更应通过同一可信签名发布，并在旧入口下线前让用户取得新配置。若用户在旧域名完全失效前未升级，仍可能需要手工导入配置。

## 签名更新与原生程序

普通发行更新包含 `skills/` 下的源代码。安装前验证 Ed25519 签名、文件哈希和路径。人物资料、个人记忆和授权记录不进入更新包。

原生运行器动态读取应用脚本，源码升级保留已登记的运行器。更新 Bun 内核时应发布完整平台包并验证。发行签名与操作系统代码签名、公证不同；当前原生程序尚未完成 Apple 公证或 Windows 代码签名。

## 离线组装安装包

使用 `scripts/package-release.mjs` 生成本地发行文件。该脚本不部署网站、不创建密钥，也不改变仓库的公开状态。

作者在仓库外准备 JSON 配置，包含 `authorFile`、`keyFile`、`notesFile`、`outDir`、`downloadBase` 和可选的 `previousReleasesFile`。`runtimes` 提供本次版本的 mac-arm64、windows-x64、linux-x64 构建目录。组装 ZIP 需要 Python 3 标准库；安装包使用者不需要 Python。

组装器核对作者配置、密钥位置、构建版本与签名。用户安装包仅包含五个 Skill、公开帮助、许可和启动器源代码；原生包另含对应运行器。服务端、测试、人物资料、开发记录和私钥不进入安装包。

输出包含平台 ZIP、`SHA256SUMS.txt`、独立版本 `release.json`、`update.json`，以及待发布的 `latest.json / releases.json / author.json`。同版本目录不能覆盖，历史版本继续保留在清单中。

发布顺序：

1. 更新版本并完成测试与校验。
2. 构建对应版本的运行器，组装安装包并签名。
3. 在隔离目录验证安装、旧版本升级和数据保留。
4. 上传新的固定版本目录，实际下载并核对哈希。
5. 切换发行清单与官网说明，保留旧包。

CI 开发构建用于验证；它不等于官方安装包。准备公开 CI 构建时，应单独核对公开文档、许可、启动器源码和配置范围。
