# v1.0.0 发布准备记录

核对日期：2026-10-20。目标：首个正式版。此记录不会代替发布提交、签名产物与真实安装验收。

## 已修复

- 气泡来源与文字一起传递，覆盖消息插入、其他 Agent 插入及来源超时的回归场景。
- 构建禁用 `public/` 自动复制，图标通过显式资源引用打包；方块猫 / 写实猫切换保留，六个写实运行时资源按固定哈希白名单打包，其他本地实验素材不进入产物。
- 生产构建只含 `index.html` / `management.html`。调试台仅开发版可打开，回归探针保留在开发环境。
- 主界面隐藏无行为消费者的性格备注、开发调试入口及只读辅助功能状态；保留实际生效的五个性格滑杆。
- 页脚版本从应用读取；去掉产品界面中调试接口指引和未呈现的「成长」承诺。
- Linux CI 不执行依赖 macOS `plutil` 的两个去重场景；macOS Rust job 明确执行它们。
- Release workflow 在待发布 tag 上执行 Rust 测试；本地及 CI 构建验证真实前端产物和解包后的 npm 服务。
- npm 命令入口加可执行权限；三个独立插件目录补齐 LICENSE.md。
- 根据真实 CI 的 Node.js 20 弃用提示，将 cache / upload-artifact 更新到支持 Node.js 24 的 v6。
- 中英文 README 改为下载、安装、使用优先；历史问题集中到 KNOWN_ISSUES.md。
- DSH 宿主层 skill 补充应用缺失时的安装引导和旧版升级到 v1.0.0 的流程；动态插件仍只负责启动已有应用。

## GitHub 设置（已通过 API 回读）

| 项目 | 状态 |
| --- | --- |
| 可见性 / 默认分支 | Public / main |
| Issues / Wiki | 开启 / 关闭 |
| 合并方式 | 只允许 squash，合并后删除分支 |
| main 保护 | PR、最新基线、`Contracts, tests, frontend build` 与 `Rust` 两项检查、线性历史、解决讨论；禁止强推和删除 |
| 审批 | 不要求额外批准票数，管理员保留应急绕过；适配当前个人维护方式 |
| Actions | 默认 token 只读，不能批准 PR；Release workflow 单独请求 contents:write |
| Dependabot | 配置存在；安全更新开启；检查时无未解决安全告警 |
| 密钥扫描 / 推送保护 | 已开启 |
| 私密漏洞报告 | 已开启，与 SECURITY.md 中的报告入口一致 |
| Apple 发布 Secrets | 检查时未配置；本机无可用代码签名身份 |

发布变更通过 [PR #26](https://github.com/dushaobindoudou/lingxi/pull/26) 合并；以该 PR 最新提交及 main 上两项 CI 结果为准。GitHub 保护与安全设置于 2026-10-20 再次通过 API 核对，开放 Dependabot 安全告警为 0。

## 渠道状态

| 渠道 | 准备情况 | 正式发布前动作 |
| --- | --- | --- |
| macOS 应用 | 源码与七处应用版本为 1.0.0；有通用构建、签名、校验脚本 | 提交源码后构建，跨机器安装验收；决定是否配 Developer ID + 公证 |
| npm `lingxi-mcp` | 本地 1.0.0；线上 Latest 核对时为 0.2.0；白名单打包、握手和 13 个工具校验 | 发布经过验证的 tarball，回读 version / integrity / latest |
| Claude Code | 仓库市场与独立插件清单可由 `claude plugin validate` 验证；独立插件 1.0.0 | 推送后刷新市场，真实宿主新会话验收 |
| Codex | `.agents/plugins/marketplace.json` 指向独立 Codex 插件；插件/MCP 副本与 hooks 有集成测试 | 推送后刷新市场，真实宿主新会话验收 |
| WorkBuddy | 插件与市场条目同步为 1.0.0；共享脚本副本受测试约束 | 真实宿主新会话验收 |
| DSH | 动态插件 + 两层 skill；缺失应用时引导安装，旧版按要求升级 | 在宿主实际的 skill/profile 配置中加载系统层与 `lingxi-dsh`；真实会话验收 |
| 官方插件目录 | 本次只验证仓库分发；未核验官方目录后台审核状态 | 如需官方目录曝光，另行提交审核；不能把 repo marketplace 当作官方上架 |

[Codex 官方打包说明](https://developers.openai.com/plugins/build/plugins)区分仓库市场和公共目录；
[OpenAI 提交说明](https://developers.openai.com/plugins/deploy/submission)要求独立的审核与发布。
灵犀使用本地 stdio MCP；[桌面插件提交要求](https://developers.openai.com/plugins/deploy/desktop-only)目前还要求提交组织获得本地 MCP 提交资格。未核验该账号是否具备资格，当前仓库包不宣称可直接通过官方目录审核。
[Claude 市场文档](https://code.claude.com/docs/en/plugin-marketplaces)要求清单校验和安装分别测试。

## 版本与已知问题

应用、npm 服务、Claude / Codex / WorkBuddy 插件以 1.0.0 建立首个正式版基线；后续仍可独立升版本。
[#3–#8](KNOWN_ISSUES.md)保持打开，避免把实现了一部分的旧设计议题误标成验收完成。
Dependabot 的开放 PR 中包含主版本升级；本次未批量合并。当前前端依赖经 npm 官方 registry 审计无已知漏洞。

## 发布前剩余事项

- [ ] 对此次发布提交跑绿远程 CI。
- [ ] 源码提交后重新打通用包，BUILD_INFO.json 必须 `dirty:false`，版本和 tag 都是 1.0.0。
- [ ] 明确签名档位。无 Developer ID 的构建必须在发布说明标明未公证与首次启动步骤。
- [ ] 完成 [跨机器与真实宿主验收](KNOWN_ISSUES.md)。
- [ ] 上传 GitHub 应用 Release 并设为 Latest，保留 universal DMG / app.zip / SHA256SUMS.txt。
- [ ] 发布 npm 1.0.0，确认安装器取到的 Latest 是应用版本，而非模型资产版本。
- [ ] 确认推广文案与许可证的非商业使用条款一致。

用户已授权合并与发布 GitHub Release、npm 及仓库插件分发；官方目录审核仍是独立流程，本次不宣称已通过审核。npm 官方 registry 登录已验证，发布使用 registry.npmjs.org。

## 合并范围

- 已合并 `feat/realcat-style`、两条行走修正工作树历史及 `lookdev/b4-review`、`lookdev/v5-face-calib`、`lookdev/v6-ref-match` 的已提交代码；`main` 与旧发布分支的能力也在当前分支中。
- 写实猫保留毛发、胡须、接触阴影、步态、跳跃、五种手动特效与连续轻抚反馈；恢复精确的按住左键轻抚规则，按真实姿态识别头部、身体、露出的腹部，悬停不触发。旧 `petting` 客户端仍兼容当前 `pet` 标识。
- 建模工具、参考与历史审计保留在源码中，开发页面和探针不进入应用与 npm 包。跨分支合并未重新烘焙正式模型，仍使用固定哈希的六个发布资源。
- 自动特效遵守默认关闭、实时能力检查、全 Agent 共享 10 分钟冷却；手动特效位于玩法页，托盘只移除特效子菜单。Skill 与四个宿主副本一致，结构校验通过。

## 本机验证结果

- `npm run validate`：项目检查通过，341 项 JavaScript 测试通过，包含两种形态往返切换、加载失败保留原猫及快速取消切换。
- `cargo test --locked --lib`：90 项 Rust 测试通过，包含形态设置的持久化与旧版兼容。
- `cargo check --locked --release`：正式编译配置通过，开发调试窗口已受编译条件保护。
- `claude plugin validate .` 与独立 Claude 插件校验：通过。
- macOS hook 去重的两个定向场景：通过。
- `npm run check:release`：正式前端只有两页，资源引用可解析；真实 npm tarball 解包后返回正确版本和 13 个带 schema 的工具；独立插件许可证一致。
- npm 官方 registry 审计：前端依赖已知漏洞为 0。已跟踪文本的常见密钥标记扫描未发现候选项；GitHub 开启扫描后回读的未解决密钥告警为 0。
- 浏览器检查：正式构建的设置页无调试入口与辅助功能状态，性格页保留五个滑杆且不显示性格备注。浏览器没有 Tauri 后端，此项仅验证页面与布局，不替代原生交互验收。

后续维护优化：Rust 控制与宿主接入逻辑集中在较大的 lib.rs 中，可在后续版本按状态边界拆分；当前前端最大 JS chunk 含 Three.js，仍有体积提示，桌面包无需网络下载该 chunk。
