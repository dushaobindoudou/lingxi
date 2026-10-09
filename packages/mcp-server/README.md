# lingxi-mcp · 灵犀

> 来源：**灵犀 lingxi** — <https://github.com/dushaobindoudou/lingxi>

灵犀是一只住在 macOS 桌面上的 3D 小猫。这个包让任何 MCP 宿主（Codex、Cursor、WorkBuddy、Claude、
豆包……）和终端都能驱动它：报告任务和心情、让猫说话、换表情动作、记住关于你的事、过一会儿提醒你。

**应用没装也不用先去装。** 宿主连上这个 server 时，它发现 Mac 上没有灵犀，就在后台从
[GitHub Releases](https://github.com/dushaobindoudou/lingxi/releases) 下载最新版，校验 SHA256、bundle id
和代码签名后装进「应用程序」并打开；已经装了就直接复用。设置、记忆、提醒都存在应用自己的数据目录里，
卸载重装、升级都会沿用。

只支持 macOS；只连本机 `127.0.0.1:47811`，事件不出这台电脑。需要 Node.js 22+。

## 接到 MCP 宿主

```jsonc
// Cursor（~/.cursor/mcp.json）、Claude Desktop、WorkBuddy（~/.workbuddy/mcp.json）等 JSON 配置
{
  "mcpServers": {
    "lingxi": { "command": "npx", "args": ["-y", "lingxi-mcp"], "env": { "LINGXI_AGENT": "cursor" } }
  }
}
```

```toml
# Codex（~/.codex/config.toml）
[mcp_servers.lingxi]
command = "npx"
args = ["-y", "lingxi-mcp"]
env = { LINGXI_AGENT = "codex" }
```

`LINGXI_AGENT` 是猫气泡上显示的身份（`codex`、`cursor`、`claude`……）。WorkBuddy 例外：它按配置哈希
记录信任，`env` 里多一个键就会让已授权的 server 失效，所以那里不要写 `env`，身份写进
`~/.lingxi/agent.json`（`{"id":"workbuddy","name":"WorkBuddy"}`）。

13 个工具：报告任务（`lingxi_task`，含 `mood`）、看能力和状态、说话、表情/动作、全屏特效、放玩具、
记住一件事、读回记忆、设提醒、换视角主题、重载自定义资源、注册身份。

`lingxi_task` 的可选 `session` 可以填写当前宿主的真实会话／线程 id，让主动报告与生命周期
通知匹配到同一任务行，减少重复播报。未知时省略，不要借用其它会话的 id。
MCP 握手里的版本与 npm 包版本一致，便于确认宿主实际加载了哪一版。

## 有专门插件的宿主

装插件比手配 MCP 多一半：宿主自己的 hooks 会在会话开始、等你授权、回合结束时让猫有反应，
不靠模型想起来。插件同样会在应用没装时从 GitHub 自动安装。

| 宿主 | 安装 |
|---|---|
| Claude Code | `claude plugin marketplace add dushaobindoudou/lingxi && claude plugin install lingxi@lingxi` |
| Codex | `codex plugin marketplace add dushaobindoudou/lingxi && codex plugin add lingxi@lingxi` |
| WorkBuddy / CodeBuddy | `/plugin marketplace add dushaobindoudou/lingxi`，然后 `/plugin install lingxi@lingxi` |

## 终端

```sh
npx -p lingxi-mcp lingxi up          # 没装就从 GitHub 装，没开就打开
npx -p lingxi-mcp lingxi say "你好"
LINGXI_AGENT=codex npx -p lingxi-mcp lingxi task completed test proud "测试全部通过"
```

全局装一次就有 `lingxi` 和 `lingxi-mcp` 两个命令：`npm i -g lingxi-mcp`。

## 环境变量

| 变量 | 作用 |
|---|---|
| `LINGXI_AGENT` / `LINGXI_AGENT_NAME` / `LINGXI_AGENT_BADGE` / `LINGXI_AGENT_COLOR` | 以谁的身份说话；不设时读 `~/.lingxi/agent.json` |
| `LINGXI_AUTOINSTALL=0` | 应用没装时不要自动安装 |
| `LINGXI_AUTOSTART=0` | 应用没开时不要启动它（也不安装） |
| `LINGXI_PORT` | 应用桥接端口，默认 47811 |

## 许可

PolyForm Noncommercial 1.0.0，附来源标注要求，见 [LICENSE.md](LICENSE.md)。商业使用需另行授权。
