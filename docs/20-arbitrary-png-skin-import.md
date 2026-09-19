# 任意 PNG 导入：覆盖整个方块模型

需求修正：用户要把任意 PNG 当作皮肤导入，覆盖猫的头、耳朵、身体、腿、脚和尾巴。PNG 导出只作为附加功能。图片不需要预先制作成 Lingxi 专用展开图。

## 已实现的实验室用法

打开 `http://localhost:1420/style-lab.html`：

1. 点击“选择 PNG”，或拖拽到导入区。普通照片、图案、像素画 PNG 都可以，支持长方形。
2. 默认“全身平铺”：重复图案，以模型单位保持每个面的图案比例，调节“图案大小”。
3. “整图铺到每一面”：每个方块面使用整张图片做居中裁切，保持原始比例。图片可能被裁去一部分，但不会拉伸变形。
4. “像素清晰 / 柔和照片”决定 nearest / linear 过滤。
5. 关闭“保留动态五官”可隐藏叠加的眼睛、嘴巴、鼻子、围嘴、符号贴片，完全展示导入的图片。
6. 精确安排图案时，同时选择 PNG 与 JSON，或者先选 PNG，再“导入 UV 配置”。
7. 点击内置皮肤卡恢复预设毛色和原始 UV。PNG 和 JSON 不上传服务器，页面重载后恢复预设。

“专用展开图”是保留的高级模式：仅用于本骨架配套 atlas，它仍然要求匹配尺寸。普通 PNG 不受这项限制；每次单独导入新 PNG 都会退出旧的 atlas 模式。

本次仍是可运行的接入示例，正式 Tauri 管理页与宠物窗口尚未接入。需要正式接入时，复用本模块并把图片/配置保存到应用数据目录。

## 类似 Minecraft 的配置方式

采用“方块节点 → 六个面 → PNG 像素矩形”的配置，不必为整张图手工拆出很多文件。

以下配置可直接和素材目录的 `import-examples/colour-check.png` 一起导入：

```json
{
  "format": "lingxi-texture",
  "schemaVersion": 1,
  "rigId": "lingxi-cat-v1",
  "textureSize": [256, 128],
  "mapping": { "mode": "tile", "tileSize": 8 },
  "filter": "nearest",
  "faces": {
    "head": {
      "pz": [0, 0, 32, 32],
      "px": [32, 0, 32, 32],
      "nx": [96, 0, 32, 32]
    },
    "earL": { "pz": [96, 0, 32, 32] },
    "earR": { "pz": [96, 0, 32, 32] }
  }
}
```

- `textureSize` 必须是实际 PNG 宽高，非固定尺寸。
- `tileSize` 为一张源图高度对应的模型单位，越大则图案越大。范围 0.25–64。
- `faces` 可以省略，或只写需要定制的部位。未配置的面继续使用全局覆盖方式。
- 每个矩形是 `[x, y, width, height]`，从图片左上角开始计数；不是 `[u1,v1,u2,v2]`。
- `px/nx` = 模型局部坐标的 +X/-X，`py/ny` = +Y/-Y，`pz/nz` = +Z/-Z；猫朝向 +Z。
- `head`、`chest`、`spine2`、`pawFL`、`tail0` 等节点名来自当前 skeleton.json。
- 前一版导出的 `lingxi-skin` JSON 也可导入：程序把其 `uv` 转换为显式逐面配置。
- 不读取 JSON 中的 URL 或路径；图片必须由用户选择，防止文件位置歧义。若要保存资源包，应用负责图片与 JSON 的关联和持久化。

这是借鉴 Minecraft 的 Lingxi 格式，**并未实现 Java/Bedrock 原生 JSON 导入**。两者节点结构、面名、UV 参数含义并不相同，后续需要独立转换器。

## 代码路径与接入点

- `apps/lingxi/src/style-lab/texture-import.ts`：PNG 文件头尺寸校验、JSON 校验、三种 UV 映射、旧清单兼容。UV 计算是纯函数，不依赖 DOM 或 WebGL，可单测。
- `apps/lingxi/src/style-lab/main.ts`：选择/拖入文件、解码 PNG、替换全身材质、更新每个盒子的 UV、控制过滤方式、恢复预设与资源释放。
- `scripts/test-voxel-texture-import.mjs`：非方形 PNG、统一物理密度、居中裁切、JSON 局部 UV、无效配置、atlas 缺失、旧格式兼容测试。

实现流程：

```text
选择 PNG（可附 JSON）
→ 检查 PNG 签名、IHDR 与宽高
→ 解析和校验 JSON（如果有）
→ 预计算每个盒子的六面 UV
→ 解码 PNG，建立 sRGB CanvasTexture
→ 原子更新所有盒子的 UV 与共享材质 map
→ 释放旧导入纹理
```

保持原图分辨率，**不把任意 PNG 硬塞进现有小尺寸 atlas**。换贴图不重建骨架，原有动作照常驱动，身体材质色为白色，避免旧皮肤再次染色。

任意 PNG 的方向无法自动对应猫的解剖部位：自动模式负责覆盖，精确对位由 JSON 指定。全身平铺是每个盒子局部面重复，跨关节和相邻盒子不保证图案连续；若要把一幅完整画连续包到整个角色，应制作 UV 展开图，或后续增加 rest-space 投影。不要把“随便一张图片能导入”宣传成“任意图片自动识别五官和无缝包裹”。

透明像素当前叠在所选预设主毛色上，保持不透明实体；不会把身体打洞。PNG 8 MB 上限、宽高各 1–4096；JSON 256 KB 上限。尺寸在解码前检查，UV 禁止越界，快速连续选择通过请求序号丢弃过期结果。配置校验失败保留当前皮肤。

## 验证

```sh
npm run build --prefix apps/lingxi
node --experimental-strip-types --test scripts/test-voxel-texture-import.mjs
```

已通过 7 个映射/导入校验测试与 TypeScript/Vite 构建；浏览器验证普通 1440×900 PNG 覆盖全身，以及 256×128 PNG+JSON 同时导入后指定 5 个面的图案。
