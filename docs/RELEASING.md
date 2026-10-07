# 打包与发布

灵犀的发布是三条命令，本地和 GitHub Actions 走的是**同一套脚本**：

```sh
node scripts/version.mjs 0.2.0     # 1. 改版本号（七处一起改），提交
./scripts/release.sh               # 2. 测试 → 通用二进制构建 → 签名 → 校验（→ 公证）→ 收集产物
./scripts/publish-release.sh       # 3. 打 tag、推送、写发布说明、上传到 GitHub Releases
```

或者只推一个 tag，让 CI 去做 2 和 3：

```sh
node scripts/version.mjs 0.2.0 && git commit -am "chore: release 0.2.0"
git tag v0.2.0 && git push origin main v0.2.0     # .github/workflows/release.yml 接手
```

---

## 1. 版本号

版本号写在七个地方：`tauri.conf.json`（决定「关于」里显示的版本）、两个 `package.json`、
两个 `package-lock.json`、`Cargo.toml`、`Cargo.lock`。

- `node scripts/version.mjs` —— 列出全部七处，不一致就非零退出；
- `node scripts/version.mjs 0.2.0` —— 一次改齐；
- `npm run check` 也会检查它们一致，CI 每次推送都会跑。

`packages/mcp-server` 的版本**单独管理**：它跟正在运行的那个应用说话，协议不会因为应用发版而变。

## 2. 打包：`scripts/release.sh`

| 用法 | 做什么 |
|---|---|
| `./scripts/release.sh` | 通用二进制（Apple 芯片 + Intel），完整测试，最强的可用签名 |
| `--arch native` | 只打本机架构，快很多，试流程用 |
| `--skip-tests` | CI 用：`ci.yml` 已经在这个提交上跑过 |
| `--skip-notarize` | 有 Developer ID 时只签名、不送公证 |
| `--allow-dirty` | 允许打未提交的改动；这种产物 `publish-release.sh` **拒绝发布** |

依次做：

1. **前置检查**：版本号一致；`apps/ packages/ integrations/ presets/` 和根 `package*.json`
   没有未提交改动（其余目录——Blender 脚本、笔记——不进包，不拦发布）；通用构建需要的两个
   Rust target 都装了（`rustup target add aarch64-apple-darwin x86_64-apple-darwin`）。
2. **测试**：`npm test`、`tsc`、`cargo test`、`npm run check`，任何一项红就停。
3. **选签名身份**（见第 4 节）。
4. **构建**：`tauri build --target universal-apple-darwin`。签名由 Tauri 在**打 .dmg 之前**完成，
   带 hardened runtime 和 `entitlements.plist`。
5. **校验**，.app 本体和 .dmg **里面那份**都要过：签名能验、有 `_CodeSignature`（链接器自带的
   ad-hoc 标记也能验过，缺的就是这个）、hardened runtime、entitlements 真的写进去了、确实是通用
   二进制，而且 .dmg 里那份的 cdhash 和外面这份一致。
6. **公证**（仅 Developer ID）：提交 .dmg、等结果、staple、Gatekeeper 评估。
7. **收集**到 `release/v<版本>/`（已 gitignore）：

   | 文件 | |
   |---|---|
   | `Lingxi-<版本>-universal.dmg` | 用户下载的就是它 |
   | `Lingxi-<版本>-universal.app.zip` | 同一个 .app，用 `ditto` 打的（`zip` 会弄坏包内符号链接，等于亲手制造"已损坏"） |
   | `SHA256SUMS.txt` | |
   | `BUILD_INFO.json` | 提交、签名方式、是否公证、cdhash、工具链版本；发布脚本读它 |

   文件名是 ASCII：GitHub 会改写 release 附件名里的非 ASCII 字符，`灵犀_0.1.0_universal.dmg`
   传上去就认不出来了。应用本身仍然叫「灵犀.app」。

**为什么要这个脚本**：光跑 `npm run tauri build` 出来的包**没有 `_CodeSignature`**，只有链接器给
二进制打的 ad-hoc 标记。在构建它的那台机器上能跑（没被隔离），发给别人就是
"已损坏，无法打开"。旧版脚本修了 .app，却是在 Tauri 已经把没签好的那份装进 .dmg **之后**才签的——
用户真正下载的那个 .dmg 还是坏的。现在由 Tauri 在打 .dmg 前签名，脚本再去 .dmg 里面验一遍。

构建时设了 `CI=true`：让 Tauri 打 .dmg 时跳过摆放 Finder 窗口的 AppleScript。那段脚本要控制
Finder，终端从没被授权过的 Mac 上 macOS 会弹「自动化」授权框把构建卡住。.dmg 内容一样（应用 +
「应用程序」快捷方式），只是图标不是手摆的位置。

## 3. 发布：`scripts/publish-release.sh`

| 用法 | |
|---|---|
| `./scripts/publish-release.sh` | 给 HEAD 打 `v<版本>`，推分支和 tag，建 release，传附件 |
| `--draft` | 建成草稿，自己确认后再点发布 |
| `--prerelease` | 标成预发布 |
| `--no-push` | CI 用：tag 已经推上去了 |

它会拒绝：`--allow-dirty` 打的包；打包之后**应用源码又改过**的包（只改了文档或脚本的提交没关系，
包的字节不会变，tag 直接打在 HEAD 上）；已经存在、却不指向 HEAD 的同名 tag（发布过的 tag 不挪，
升版本号）。

发布说明是生成的：适用系统和架构、安装步骤（**没公证时附上放行步骤**）、校验和、自上个 tag 以来
的提交。已经存在的 release 会被更新附件和说明，而不是报错。

它打的 tag 带一行 `Release-Build: local`。CI 看到这一行就跳过构建——否则推 tag 的瞬间 CI 也会开始
一轮 20 分钟的 macOS 构建，然后用它自己的产物覆盖你刚传的。

## 4. 签名与证书

### 三档，脚本自动选最强的

| 档位 | 条件 | 用户下载后第一次打开 |
|---|---|---|
| **ad-hoc** | 默认：本机没有 Developer ID | 被拦一次：「系统设置 → 隐私与安全性 → 仍要打开」，之后正常 |
| **Developer ID，未公证** | 有证书，`--skip-notarize` 或没配公证凭据 | 同上——签名说明了是谁做的，但 Apple 没看过 |
| **Developer ID + 公证** | 有证书且配了公证凭据 | 直接打开，没有任何提示 |

选择顺序：`APPLE_SIGNING_IDENTITY` 环境变量 → 钥匙串里的第一个 `Developer ID Application` →
ad-hoc（`-`）。**构建本身不需要任何证书**——编译、打包、ad-hoc 签名全在本机完成。

ad-hoc 不是"没签名"：包是完整签好的，`codesign --verify --deep --strict` 能过，hardened runtime
开着。缺的只是一个 Apple 认可的身份。

### 为什么没有自签名证书

试过，结论是它**不带来任何好处**：

- `codesign` 拒绝用不受信任的身份签名（`no identity found`），要用就得先在钥匙串里把它设成
  "始终信任"——那一步会弹系统授权框，每台构建机都要来一次，CI 上还得 `sudo`；
- 在**别人的** Mac 上，Gatekeeper 对自签名和 ad-hoc 一视同仁，提示和放行步骤完全一样；
- 自签名唯一实在的好处是签名身份跨版本不变，于是 TCC 授权（辅助功能、屏幕录制……）升级后不会丢。
  但灵犀**不申请任何 TCC 权限**（光标位置用 `NSEvent.mouseLocation` 读，见 `lib.rs`），这个好处落空。

### 真正有用的证书：Developer ID Application

只有 Apple 能签发，前提是加入 **Apple Developer Program**（99 美元/年，需要 Account Holder 身份）。
本机能做的步骤都在 `scripts/apple-signing.sh` 里：

```sh
./scripts/apple-signing.sh csr        # 1. 生成私钥和证书签名请求（CSR）      ← 已经生成好了
# 2. 浏览器：https://developer.apple.com/account/resources/certificates/add
#    选 Developer ID Application → G2 Sub-CA → 上传 CSR → 下载 .cer
./scripts/apple-signing.sh import ~/Downloads/developerID_application.cer
                                       # 3. 证书 + 私钥 → 签名身份（放在独立钥匙串）
./scripts/apple-signing.sh notary     # 4. 存公证凭据（Apple ID、Team ID、App 专用密码）
./scripts/apple-signing.sh github     # 5. 写进仓库 Secrets，让 CI 也能签名 / 公证
./scripts/apple-signing.sh status     # 随时看进度
```

做完 3，`release.sh` 自动改用 Developer ID 签名；做完 4，本地发布加上
`APPLE_KEYCHAIN_PROFILE=lingxi-notary ./scripts/release.sh` 就会公证。**构建脚本一行都不用改。**

私钥和 CSR 在 `~/.lingxi-release/apple/`（目录 0700、私钥 0600，**不在仓库里**）。**私钥丢了，
Apple 签发的证书就作废了**——备份它，或者在导入之后备份 `developer-id.p12`（它包含私钥和证书，
密码在登录钥匙串里，服务名 `lingxi-release`、账户 `p12`）。

签名身份放在单独的 `~/Library/Keychains/lingxi-release.keychain-db`，而不是登录钥匙串：`codesign`
要免弹窗使用一把私钥，需要先设置钥匙串的 partition list，而那一步要钥匙串密码——登录钥匙串的密码
就是你的开机密码。独立钥匙串的密码是随机生成、存进登录钥匙串的，`release.sh` 重启后会自己解锁它。

## 5. GitHub Actions：`.github/workflows/release.yml`

- **触发**：推送 `v*` tag；或 Actions → Release → Run workflow，手动指定一个已有 tag 重新构建。
- **跳过**：`publish-release.sh` 推的 tag（带 `Release-Build: local`）。手动触发永不跳过。
- **校验**：tag 必须和源码里的版本号一致。
- **签名**：有 `APPLE_CERTIFICATE` 等 Secrets 就导入临时钥匙串用 Developer ID；没有就是 ad-hoc。
  有 Developer ID 却没配公证 Secrets 时**停下**，而不是发一个 Gatekeeper 会拒的包。
- **产物**：发布到 GitHub Release，另存 14 天 workflow artifact。

| Secret | 来源 |
|---|---|
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` | `apple-signing.sh github` 自动设置 |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | 同上，运行时在环境变量里提供这三个即可 |

**费用提醒**：仓库是私有的，GitHub 给私有仓库的 macOS runner 按 **10 倍**计分钟。一次通用二进制
发布构建冷启动约 20–30 分钟，也就是 200–300 分钟额度；免费额度每月 2000 分钟。本地发布
（`release.sh` + `publish-release.sh`）不花额度——这也是本地发布的 tag 会让 CI 跳过的原因之一。

## 5½. 接入渠道：插件市场、npm、skill

应用发到 GitHub Releases 之后，接入渠道不用另外"上架"——除了 npm，它们都直接读这个公开仓库的默认分支：

| 渠道 | 读的是 | 用户命令 | 发布动作 |
|---|---|---|---|
| Claude Code 插件 | `.claude-plugin/marketplace.json` → `integrations/hosts/claude` | `claude plugin marketplace add dushaobindoudou/lingxi` | 推到 main；改了插件就升 `plugin.json` 的 `version` |
| Codex 插件 | `.agents/plugins/marketplace.json` → `integrations/hosts/codex/plugin` | `codex plugin marketplace add dushaobindoudou/lingxi` | 同上 |
| WorkBuddy / CodeBuddy | `.codebuddy-plugin/marketplace.json` → `integrations/hosts/workbuddy/plugin` | `/plugin marketplace add dushaobindoudou/lingxi` | 同上 |
| skill 目录（skills.sh 等） | 仓库里的 `SKILL.md` | `npx skills add https://github.com/dushaobindoudou/lingxi/tree/main/integrations/skills` | 推到 main |
| npm `lingxi-mcp` | `packages/mcp-server/` | `npx -y lingxi-mcp` | 见下 |

skill 那一行必须带 `integrations/skills` 子路径：只写 `owner/repo` 时 skills CLI 会顺着 `.claude-plugin/marketplace.json`
找到 Claude 插件里的 skill，把 Claude 专用的宿主层 `lingxi-claude` 装给别的宿主，还漏掉 `lingxi-authoring`。

**每个插件在应用没装时都会去下 Releases 里标为 Latest 的那个 release 的
`Lingxi-*-universal.dmg` 和 `SHA256SUMS.txt`**，所以：模型资产之类的非应用 release 不能标成 Latest；
应用 release 必须是通用二进制（`release.sh` 默认就是）。

### npm：`lingxi-mcp`

版本单独管理（见第 1 节），改了 `packages/mcp-server/` 就升它自己的版本号：

```sh
cd packages/mcp-server
npm version patch --no-git-tag-version          # 或手改 package.json
npm test && npm pack --dry-run                  # 看清楚要发哪些文件
npm login --registry https://registry.npmjs.org/   # 本机 registry 若是镜像，发布必须显式指定官方源
npm publish                                       # publishConfig 已指向官方源、access public
```

包里的 `scripts/`、`bin/lingxi`、`LICENSE.md` 是副本，`npm test`（根目录）的 `shared-copies` 测试守着它们
和源头一致——测试不过不要发。

## 6. 排查

| 现象 | 原因 / 办法 |
|---|---|
| 用户说"已损坏，无法打开" | 签名不完整或包被改过。`codesign --verify --deep --strict --verbose=4 灵犀.app` 看哪里坏了；别用 `zip` 重新打包 .app |
| 用户说"无法验证开发者" | 没公证，正常。按发布说明里的「仍要打开」放行；要消掉它只能上 Developer ID + 公证 |
| `Rust target x86_64-apple-darwin is missing` | `rustup target add x86_64-apple-darwin aarch64-apple-darwin` |
| 构建时弹「想要控制 Finder」 | 没走 `release.sh` 直接跑了 `tauri build`；脚本设了 `CI=true` 来跳过这一步 |
| 公证失败 | `xcrun notarytool log <submission-id> --keychain-profile lingxi-notary` 会逐条列出原因 |
| `APPLE_SIGNING_IDENTITY ... no valid identity` | 证书链不全或钥匙串没解锁；`./scripts/apple-signing.sh status` |
| `publish-release.sh`：app sources changed since this build | 打包之后又改了应用代码，重新 `release.sh` |
| `cargo: command not found` | rustup 的 `~/.cargo/bin` 不在 PATH；脚本会自动补上，手动跑时 `PATH="$HOME/.cargo/bin:$PATH"` |

## 7. 发版检查清单

- [ ] `node scripts/version.mjs <新版本>`，提交
- [ ] `./scripts/release.sh` 全绿，结尾的签名档位是你预期的那一档
- [ ] 在**另一台** Mac（或新用户账户）上从 .dmg 安装、打开一次：猫出现、托盘可用、主界面能开
- [ ] `./scripts/publish-release.sh`（第一次不放心就加 `--draft`，在网页上看过再发布）
- [ ] Releases 页面上附件齐全：.dmg、.app.zip、SHA256SUMS.txt
- [ ] 这个 release 标成了 **Latest**（插件自动安装只认 Latest）
- [ ] 在一个临时环境里走一遍"没装就装"：`LINGXI_APP_PATH=/nope LINGXI_INSTALL_DIR=$(mktemp -d) integrations/shared/install-app.sh` 能下载、校验、装好
- [ ] `packages/mcp-server/` 改过的话：升版本、`npm publish`
