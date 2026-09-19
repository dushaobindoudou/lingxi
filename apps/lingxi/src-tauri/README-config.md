# 配置目录

灵犀把**所有**运行时数据放在一个目录里，不碰源码树，也不写进 `.app` 包（包里的东西下次
构建就没了）：

```
~/Library/Application Support/com.dushaobin.lingxi-desktop/
├── settings.json          大小 / 主题 / 视角 / 可见性 / 性格预设，托盘一改就落盘
├── bridge-token           本机 HTTP 桥的鉴权 token，权限 0600，首次启动生成
├── memory.json            关于主人的记忆（纯文本，用户可以自己打开读）
├── reminders.json         定时提醒
└── assets/                用户和 agent 都可以改的资源
    ├── actions.json       动作库        （整体替换）
    ├── expressions.json   表情库        （整体替换）
    ├── skins.json         主题          （与内置合并）
    ├── face.json          五官几何      （按字段覆盖）
    ├── bubble.json        气泡样式      （整体替换）
    ├── reactions.json     任务→反应映射 （按条覆盖）
    ├── textures/*.png     手绘图集 / 表情贴图
    └── README.md          格式说明（应用自己写出来的）
```

安装版和源码构建版**共用同一个 bundle id**，所以它们读的是同一个目录——改一次两边都生效。

- 主界面 →「外观」→「导出内置资源为模板」会把整套 `assets/` 写出来。
- 改完 `POST /control {"reloadAssets":true}`，然后 `GET /assets/status` 看校验结果。
- 每个文件**独立校验**：写坏一个不会影响其余的。
