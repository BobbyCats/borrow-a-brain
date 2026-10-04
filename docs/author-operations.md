# 作者端运行与分发

## 当前生产接入

2026-10-05，0.1.1 体验版已接入珈承科技网站。私有仓库仍保持私有；公开安装包只含审核过的 Skill 与运行文件。

- 使用说明：https://jclab.top/tools/borrow-a-brain/
- 版本说明：https://jclab.top/tools/borrow-a-brain/updates/
- 管理入口：https://jclab.top/admin/feedback/
- 发行清单：https://jclab.top/downloads/borrow-a-brain/releases.json
- 签名更新：https://jclab.top/downloads/borrow-a-brain/latest.json

网站页面、反向代理配置和发布验收由部署者维护；服务与客户端协议在本仓库维护。

## 私有反馈服务

完整服务运行 `server/console.mjs`，包装 `server/feedback.mjs` 收件接口。服务监听本机回环地址，通过可信 HTTPS 代理访问。只有代理覆盖客户端地址时才启用 `BAB_TRUST_PROXY=1`。

环境变量：`BAB_INBOX_HOME`、`BAB_ADMIN_TOKEN`、`BAB_LOGIN_HASH`、`BAB_ORIGIN`、`BAB_ADMIN_HTML`、`BAB_RELEASES_FILE` 必填；`PORT`、`BAB_TRUST_PROXY` 按环境设置。仅隔离本机联调可使用 `BAB_LOCAL=1`。

| 接口（服务内部路径） | 权限与作用 |
| --- | --- |
| POST /v1/feedback | 结构化收件，大小限制、来源限频和幂等编号 |
| GET /v1/feedback/:id | 独立回执令牌；返回状态、修复版本和给用户的进展 |
| POST /session | 同源登录、scrypt 口令校验与登录限频 |
| GET /session | 当前会话状态与 CSRF 凭据 |
| DELETE /session | 同源与 CSRF 校验后退出 |
| GET /admin/feedback | 管理会话或管理员 Bearer；不返回报告查询令牌 |
| PATCH /admin/feedback/:id | 管理鉴权、修订号冲突检查、状态与发布版本检查、记录审计 |

处理状态：received / working / waiting / resolved / closed。resolved 必须指定已发布版本；closed 必须填写原因。内部备注和给用户的进展分开。不能把作者标记 resolved 当作用户已验收。

Web 会话使用 HttpOnly、Secure、SameSite=Strict Cookie，8 小时有效；重启进程会使管理会话失效。长期管理员令牌和登录哈希位于服务端环境文件，不能放在网页、安装包、版本清单或 Git。API 日志不记录正文与凭据。

部署时将程序、私密环境和反馈数据分别保存。每日运行 `server/maintenance.mjs`，结案 90 天清理报告正文与备注，私有 JSON 备份保留 7 天。网页回滚不能覆盖反馈数据。

`server/feedback.mjs` 仍可独立运行，用于协议测试。独立模式只提供原始 API，不提供管理会话和界面；默认 8787。生产应使用完整 console 服务。

## 配置和域名迁移

源码仓库的 `skills/bab/assets/author.json` 保持空地址默认值。正式安装包在组装时注入官网、反馈源、更新源和可信公钥。私钥始终在仓库外，只有公钥进安装包。

用户 `config-set` 保存的本地覆盖配置优先于随包配置。升级时不能默默覆盖。0.1.0 用户需要按新安装说明检查配置和安装预览，再确认更新。

迁移域名不能只添加 301/307：当前反馈、查询和更新客户端使用 `redirect: 'error'`。旧域 API 应透明代理同一后端；旧更新路径应直接返回签名包，至少保留一个旧客户端可达入口。历史草稿、确认摘要、回执和本地覆盖配置须分别验证。不得承诺所有旧入口失效后仍能自动发现新地址。

## 签名更新与原生包

发行更新仅包含 `skills/` 源代码。Ed25519 签名验证后才能安装；文件哈希和路径一并校验。个人数据不进入包，也不随升级覆盖。操作系统的代码签名、公证与发行签名是不同工作；当前原生程序未做系统签名或公证。

网站 `scripts/prepare-bab-release.mjs` 组装经过审核的发行文件。带版本号文件不覆盖；`latest.json` 与发行清单指向真实已上传版本。私有 GitHub 凭据不得分发给用户。

完整发布：更新版本 → 执行测试和 validate → 构建或复用验收过的原生运行器 → 组装并签名 → 隔离安装与升级验收 → 上传固定版本目录 → 更新发行清单与官网 → 实际下载回读。

原生运行器动态加载脚本，源码升级保留已登记的运行器。更新 Bun 内核时另发完整平台包并验证，不能把二进制变更伪装成普通方法更新。


## 0.1.2 之后的离线发行组装

使用本仓库 `scripts/package-release.mjs`，不再把版本、域名和开发机路径硬编码进发行脚本。它只生成本地文件，不部署、不创建密钥，也不公开仓库。

作者在仓库外准备 JSON 配置：authorFile、keyFile、notesFile、outDir、downloadBase、previousReleasesFile；runtimes 提供 mac-arm64 / windows-x64 / linux-x64 的本次 CI 构建目录。作者机需要 Python 3 的标准库生成 ZIP；使用者不需要 Python。

组装器核对作者配置、密钥位置、对应构建版本和签名。只打包五个 Skill、公开帮助、许可与启动器源代码。服务端、测试、人物资料、状态和私钥不进入安装包。同版本目录不能被覆盖，历史版本号继续保留在清单中。

输出包含四个平台包、SHA256SUMS、独立版本 release.json、update.json，以及待发布的 latest.json / releases.json / author.json。发布时先上传新版本目录并验哈希，再切换清单和说明；保留旧包。地址变更通过同一可信签名发布，在旧入口下线前让用户取得新配置。单一域名彻底失效前未升级的离线用户仍可能需要手工导入新配置；不要把配置化宣传为永不失联。
