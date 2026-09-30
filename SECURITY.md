# 安全与隐私

## 报告漏洞

请使用仓库的 [Security Advisories](https://github.com/dushaobindoudou/lingxi/security/advisories/new) 私下报告，或直接联系维护者 `@dushaobindoudou`。

不要在公开 issue、Pull Request 或讨论里附凭据、桥接 token、私人会话、记忆文件内容。给出可以复现的版本、平台和最小步骤即可。

我们会确认收到，并在修复进入发布说明之后再公开细节。

## 支持范围

| 版本 | 状态 |
| --- | --- |
| `main` 上的当前桌面应用 | 接受报告 |
| 更早的未标记构建 | 不单独维护 |

应用只支持 macOS。桥只监听 `127.0.0.1`。回环不是信任边界：本机任意进程都能连上，所以除 `GET /health` 外都要 token。token 文件权限应为 `0600`。

## 产品边界

观察层只接收必要的任务元数据，没有批准、执行或取消任务的接口。MCP 不打进终端用户应用。Blender Lab MCP 可以执行 Blender Python，配置为本机回环、手动启动；设计结束时从 Blender 扩展面板停掉。

外部模型、材质、纹理和脚本都按不可信输入处理。普通皮肤包不运行任意 Python 或 JavaScript。依赖和 GitHub Actions 由 Dependabot 定期更新。CI 权限默认只读。
