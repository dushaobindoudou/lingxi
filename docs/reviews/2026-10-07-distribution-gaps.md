# 发布与接入盘点 · 2026-10-07

快照，不是状态板（属于 [`docs/README.md`](../README.md) 的第三层）。问题是：**一个从没见过灵犀的人，
在他已经在用的 agent 里装上我们的接入，猫能不能出现在他桌面上？** 以及离"发布出去"还差什么。

基线：`a72e964`（v0.3.0），读了 `README`、`integrations/**/README.md`、`hosts/PLUGIN-STANDARD.md`、
`RELEASE-READINESS-2026-09-24.md`、`docs/RELEASING.md`、`docs/19`，并在本机逐个宿主实测。

---

## 一、盘点时的状态

| 渠道 | 用户怎么装 | 应用没装时 | 问题 |
|---|---|---|---|
| Claude Code 插件 | `claude plugin marketplace add dushaobindoudou/lingxi` | ✅ 会话开始时从 GitHub 装 | 无 |
| Codex | 只有仓库里的 `install.sh` | ❌ 什么都不做 | **Codex 0.15x 已经有插件市场**，而它读不到我们的 Codex 清单时会退回读 `.claude-plugin/marketplace.json`——`codex plugin marketplace add dushaobindoudou/lingxi` 会把 **Claude 插件**装给 Codex 用户，事件全记成 claude |
| WorkBuddy 插件 | `/plugin marketplace add`（`.codebuddy-plugin`） | ❌ | 只有生命周期 hooks，没有会话开始检查 |
| Cursor / 豆包 / WorkBuddy 安装器 | 克隆仓库后跑 `install.sh` | ❌ | 要求先装好应用 |
| MCP server | `node <repo>/packages/mcp-server/src/index.mjs` | ❌ 回一句"去 `npm run tauri build`" | 不克隆仓库就用不了；npm 上没有 |
| `lingxi up` | — | ❌ 同上 | |
| 安装器本身 | — | — | 安装锁按宿主分开：两个宿主同时开第一个会话会各下一次、互相替换同一个 .app。另外"找不到已装应用"时（Spotlight 没建好索引、路径被覆盖）会**覆盖**目标位置已有的灵犀——本轮实测踩到过一次 |

PLUGIN-STANDARD 2026-09-24 的审查早就把 A1（没装就装）和 E2（自包含）列成除 Claude 外全部 ✗，
建议"把 `install-app.sh`、`lib.sh` 抽到共享位置，打包进每个插件"。本轮按这个建议做完。

## 二、本轮补上的

1. **`integrations/shared/`**：`lib.sh` / `install-app.sh` / `ensure-app.sh` 按 `LINGXI_HOST` 参数化，
   每个插件、npm 包带逐字副本，`shared-copies.test.mjs` 守着。安装锁改为全机唯一；非 `--update`
   永不覆盖已装的应用（加了回归测试）。
2. **Codex 原生插件** `integrations/hosts/codex/plugin/` + 仓库根 `.agents/plugins/marketplace.json`。
   实测 Codex 的插件 hooks：载荷与 Claude 同形、会设 `CLAUDE_PLUGIN_ROOT`/`PLUGIN_ROOT`、输出认
   `systemMessage`/`additionalContext`、**需要用户在 TUI 里审核一次**（"hooks need review"）。
   桥接会把原始 hook 载荷记成 claude，所以 `event.sh` 用纯 bash 改写成通用事件、署名 codex。
   在临时 `CODEX_HOME` 里 `codex exec` 端到端验证：queued / running / completed 都以 codex 到达。
3. **WorkBuddy 插件** 加 SessionStart 检查。
4. **MCP server**：宿主连上时发现没装，后台起安装器，调用方得到"正在从 GitHub 安装"。
5. **`lingxi up`** 与 **四个宿主的 `install.sh` 第 0 步**：没装就装、没开就开；新增 `lingxi update` 升级到最新 release。
6. **npm 包 `lingxi-mcp`**（`packages/mcp-server`）：`npx -y lingxi-mcp`，带 `lingxi` 命令；打包后在临时前缀里
   装上验证过握手、13 个工具、CLI。
7. **从 GitHub 真实安装**验证：模拟"没装"、装到临时目录，12 秒完成下载 v0.3.0 通用包 → 校验 → 安装，
   并且没有在已有一只猫在跑时再开第二只。

## 三、仍然差的（按对用户的影响排序）

| # | 差什么 | 影响 | 谁能做 |
|---|---|---|---|
| G1 | **Apple Developer ID + 公证** | 从网页下载 .dmg 的人第一次打开会被 Gatekeeper 拦，要去「隐私与安全性」放行。插件 / MCP / CLI 的自动安装走 curl 下载、没有隔离属性，不受影响 | 需要项目所有者开通 Apple Developer Program（99 美元/年），之后 `scripts/apple-signing.sh` + `release.sh` 全自动 |
| G2 | **npm 账号发布 `lingxi-mcp`** | 包已就绪、测试通过；本机 npm 未登录，且默认 registry 是 npmmirror 镜像（不能发布） | 所有者 `npm login --registry https://registry.npmjs.org/` 后 `npm publish` |
| G3 | **官方目录收录** | 现在用户要知道仓库名才能 `marketplace add`。Claude 官方插件目录、Codex 推荐插件、CodeBuddy 市场、skills.sh 榜单都需要提交/审核 | 所有者提交；材料（README、图标、描述）已齐 |
| G4 | **已装用户的升级** | 自动安装只管"没装"。本轮加了 `lingxi update`（任何宿主都能用），Claude 另有 `/lingxi:setup update`；但没人会主动去跑——应用自己不提示有新版本 | 应用启动时查一次 Latest，有新版在托盘/主界面提示 |
| G5 | **宿主信任闸门** | Codex 插件 hooks 首次要审核；WorkBuddy 换了 MCP 路径要重新点「信任」。是宿主的安全设计，绕不过，只能写清楚 | 文档已写；无需代码 |
| G6 | **身份（T3）仍有漏洞** | `~/.lingxi/agent.json` 是机器级，写着 workbuddy；豆包包装器占了 `~/.local/bin/lingxi`，任何没设 `LINGXI_AGENT`、又不在 Claude/Codex shell 里的调用都记成豆包 | 让应用按调用方进程推断宿主，或把机器级文件降级为纯兜底 |
| G7 | **E2：Cursor / 豆包 / WorkBuddy 安装器仍依赖仓库路径** | 仓库挪位置或删掉，接入就断（本机 WorkBuddy 的 MCP 就指着已不存在的 `dsh-lingxi` 旧目录）。Cursor 可改用 `npx -y lingxi-mcp`；豆包没有插件机制 | 安装器把插件目录拷到 `~/.lingxi/<宿主>/` 再指过去 |
| G8 | **DSH 不会自动安装** | 单文件 Cordis 插件只会拉起已装的应用 | 小改：调用 `lingxi up` |
| G9 | **11 个 dependabot PR 未合** | tauri 2.11.6、tauri-build 2.7、TypeScript 7（大版本）、vite、three、Actions 版本 | 逐个跑 CI 合并；TS 7 需要单独验证 |
| G10 | **豆包的 MCP 调用不送达**（宿主缺陷） | 豆包里只能走 skill + CLI | 等豆包修复 |
| G11 | **只支持 macOS** | — | 产品决策 |
| G12 | **"Latest" 约定是隐式的** | 自动安装只认标为 Latest 的 release；若把模型资产之类的 release 标成 Latest，所有新用户的安装都会失败 | 已写进 `docs/RELEASING.md` 检查清单；可在 `install-app.sh` 里改为筛选 `v*` tag |

产品层面未完成的（与发布渠道无关，详见原文）：[`RELEASE-READINESS-2026-09-24.md`](../../RELEASE-READINESS-2026-09-24.md)
U1–U15（气泡居中/icon 位置无配置字段、皮肤预览、陪伴时长、Agent 心跳、DSH 一键接入、LLM 大脑、v5 骨架……）
与 GitHub issues #3–#8。
