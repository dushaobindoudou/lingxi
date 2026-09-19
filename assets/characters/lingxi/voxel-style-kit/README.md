# 灵犀皮肤素材包

现在实验室支持**导入任意 PNG 覆盖整个模型**，可使用 `import-examples/colour-check.png` 和 `.json` 测试自动平铺与逐面 UV。详见 `docs/20-arbitrary-png-skin-import.md`。

六套皮肤，每套包含身体 PNG、256×256 透明五官 PNG、显式六面 UV JSON。

- `collection.png`：配色与五官插画总览（非 3D 截图）。
- `expressions.json`：十种预设表情。
- `actions.json`：八个演示动作；futureActions 尚未实现。
- 布局固定为默认 `lingxi-cat-v1`、4 texels/unit，不可直接用于重排 UV 后的体型。
- 格式为 Lingxi 自定义 JSON，借鉴 Minecraft 方块资源组织，不直接兼容 Minecraft JSON。

完整开发文档：`docs/19-voxel-style-kit-handoff.md`。
预览：项目根目录执行 `npm run dev --prefix apps/lingxi`，打开 `http://localhost:1420/style-lab.html`。
本轮实验室支持换肤，正式 Tauri 设置页面尚待接入。

重新导出 PNG（额外工具依赖 @napi-rs/canvas，不是应用运行依赖）：

```sh
npm install --prefix /tmp/lingxi-style-export --no-audit --no-fund @napi-rs/canvas
node --experimental-strip-types scripts/export-voxel-style-kit.mjs /tmp/lingxi-style-export/node_modules/@napi-rs/canvas/index.js
```

导出脚本在 macOS 注册 PingFang 字体；其他系统应替换为可用的中文字体文件。
