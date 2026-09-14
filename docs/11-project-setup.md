# 项目设置与当前交付

项目名：灵犀 Lingxi。仓库名：dsh-lingxi。默认分支：main。私有孵化，未替用户决定开源授权。

## 本地基础

- Git、EditorConfig、换行与二进制规则、忽略本机环境和缓存。
- Node.js 22+，package-lock，基础包无第三方运行依赖。
- `npm run validate` 校验 JSON、皮肤性格配置、文档链接并运行契约测试。
- GitHub Actions 执行验证和 Python 语法编译；不会连接个人 Blender/Agent。
- Dependabot 维护 npm 与 Actions；CODEOWNERS、issue 表单、PR 模板、贡献和安全文档。
- 资产来源与生成提示记录；Blender 源文件打包图片，设计工具源码与虚拟环境不提交。

## GitHub 设置

仓库已创建并推送：[dushaobindoudou/dsh-lingxi](https://github.com/dushaobindoudou/dsh-lingxi)。[远端设置证据](evidence/github-settings.json)记录 private、main、issues 开启、Wiki 关闭、仅 squash 合并、合并后删除分支，以及 3 个里程碑和 6 项后续工作。依赖安全提示与自动修复已启用，初次 CI 通过。

**当前限制：主分支保护未启用。** GitHub 返回 HTTP 403：此账号需升级 Pro 或改为公开仓库才可启用。保持私有，不擅自公开。团队流程要求 PR 与绿色 CI，但目前服务器不能强制执行。升级后可启用 Validate 必须通过、禁止强推/删除与线性历史。

## 用户目标与证据边界

| 目标 | 产物 | 不应混淆的边界 |
| --- | --- | --- |
| 好名字 | 用户已定灵犀 Lingxi | 未做商标独占承诺 |
| 图标与设计系统 | v2 图标、变量、风格规则、原始身份参考 | 第一版被否定；v2 可继续按反馈调优 |
| 逼真 3D 桌面方案 | ADR 001 | 技术方案已写，运行效果与功耗尚未实测 |
| 官方 Blender MCP 与设计 | 官方安装、握手、参考工作场景、三版网格和毛发试作 | 已离线渲染；视觉验收未通过，无生产绑定或实时验证 |
| 多皮肤多性格 | 分离契约、配置与测试 | 计划皮肤还没有生产网格/贴图 |
| Agent 扩展性 | 统一事件、Observer 接口、已核对接入路径 | 未来在线连接功能没有虚假标为可用 |
| 标准 GitHub 项目 | 仓库、CI、设置、模板与项目事项 | 以远端证据为准 |
