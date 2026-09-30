# 参与开发

先读 [README](README.md) 里的架构和边界，再改代码。行为、渲染、桌面壳分开改；任务状态只读，不自动批准或执行命令。

## 环境

需要 Node.js 22+ 和 Rust（`rustup`；版本由 `rust-toolchain.toml` 锁定）。Blender 工作需 5.1+，当前核对过的版本是 5.2.1。

```sh
npm ci --ignore-scripts
cd apps/lingxi && npm ci --ignore-scripts

npm run validate          # 仓库根目录：规范检查 + 单元测试
cd apps/lingxi && npx tsc --noEmit
cd apps/lingxi/src-tauri && cargo test
```

`npm run tauri dev` 在 `apps/lingxi` 里启动桌面应用。改动画之前先看 `probe-gait.html` 文件头部的健康值。

## 分支与提交

从 `main` 拉分支：`feat/…`、`fix/…`、`docs/…`。提交说明用 `feat:`、`fix:`、`docs:`、`chore:` 前缀，说明为什么改。

经 Pull Request 合并 `main`。CI 必须通过。不要在公共 CI 里启动本机 Blender MCP，也不要读取个人 Agent 会话。

## Pull Request 里要写什么

- 改了什么体验，修改前后各是什么样
- 实际跑过的检查。视觉变化附桌面小尺寸预览；3D 变化写明 Blender 或运行时版本
- 还没验证的部分、兼容性和性能影响

更新决策时同步文档。预览图和真实 3D 渲染必须分得清。不要把粗模或生成参考图写成已经达到最终真实度。

## 不要提交

缓存、密钥、桥接 token、用户记忆、个人会话。大体积制作资产在进入正式生产前规划 Git LFS 或 GitHub Release，不要直接塞进 git。

新增资产要记录来源和版本。外部模型、贴图和脚本按不可信输入处理。普通皮肤包不能运行任意 Python 或 JavaScript。

社区行为见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。漏洞见 [SECURITY.md](SECURITY.md)，不要开公开 issue。

## 许可与贡献者协议（CLA）

本项目以 PolyForm Noncommercial 1.0.0 发布，商业授权由项目所有者另行签发。为了让项目所有者保留变更许可与签发商业授权的能力，提交 Pull Request 即表示你确认：

- 你对贡献内容拥有全部权利，或已获得必要授权；
- 你授予项目所有者对该贡献的永久性、全世界、可转授权的使用、修改、再许可与商业授权权利；
- 贡献不附带额外的许可限制或第三方素材，除非在 PR 说明中明确标注并获得维护者接受。

首次贡献的较大改动，维护者可能请你在提交中附签名声明（`git commit -s`，DCO 风格的 `Signed-off-by:`）。
