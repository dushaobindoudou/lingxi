# 官方 Blender MCP 与角色设计工作流

采用用户指定的 [Blender Lab 官方说明](https://www.blender.org/lab/mcp-server/)，源码为 [lab/blender_mcp](https://projects.blender.org/lab/blender_mcp)。官方要求 Blender 5.1+，当前本机是 5.2.1 LTS。

## 已安装与验证

官方 server 包版本 1.0.2，扩展 1.0.0，源码 commit 记录在 [upstream-lock](../scripts/blender/upstream-lock.json)。独立 Python 环境位于项目 `.local/blender-mcp-venv`，源码位于 `.local/blender-lab`，均不进入 Git。Codex 全局 `blender` 条目已改为官方服务。

采用 stdio → 本机 TCP `127.0.0.1:9877` → Blender。自动启动偏好为 false；本轮显式开启独立设计会话。官方 MCP 的工具能够执行 Python，不随灵犀终端用户应用分发。社区版先前安装已停用，其本轮启动的监听服务已停止。

自动审批曾拒绝自动启动设置；改成手动启动后安装已成功，没有绕过该限制。

[握手证据](evidence/blender-mcp-handshake.json)确认工具列表和场景查询；MCP 初始化返回的 server version 取自 SDK（1.30.0），不能误认为 Blender Lab 包版本。实际包版本以锁定记录为准。

## 重新开始设计

在仓库根目录运行：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --online-mode assets/characters/lingxi/source/lingxi-reference-studio.blend --python scripts/blender/start_mcp.py
.local/blender-mcp-venv/bin/python scripts/blender/mcp_client.py
```

`--online-mode` 是官方桥接器对本次进程的要求，不修改全局联网偏好。9877 若被其他设计会话占用，应复用或先手动停止该会话，不能启动多个争用同一端口的 Blender。

Codex 下一次建立 MCP 工具连接时加载新配置；当前对话通过标准 Python MCP 客户端完成调用，已验证的不是单纯 socket 探测。

安装脚本为 [install_official_addon.py](../scripts/blender/install_official_addon.py)，它依赖已下载的官方扩展 zip。新机器需按锁定源码安装独立环境并生成 zip，具体安装复现见脚本与 upstream-lock；不依赖同名 PyPI 社区包。

## 已创建的设计成果

- [角色工作场景](../assets/characters/lingxi/source/lingxi-reference-studio.blend)：打包三张参考、4 个相机、3 盏灯、毛色/鼻/虹膜/角膜材质基线与分层集合。
- [角色多视图候选](../assets/characters/lingxi/reference/turnaround-v1.png)：需要进一步对齐姿态、比例和花纹。
- [MCP 场景创建证据](evidence/blender-design-scene.json)。

工作场景以原始主猫为身份依据；场景文字说明明确标注“尚无成品角色网格、毛发、绑定或动作”。参考图片仅用于设计，渲染时隐藏，不能被误当成 3D 猫。

## 接下来的制作顺序

校正多视图 → 体积雕刻 → 四足拓扑 → UV/花纹遮罩 → 骨骼与基础姿态 → 眼睛 → 分区 Groom → 运行时毛发试验 → 呼吸、眨眼、注视 → 桌面集成。每步保留可编辑源文件及视觉检查结果，最终质量必须回到用户原始参考，不以粗模代替。
