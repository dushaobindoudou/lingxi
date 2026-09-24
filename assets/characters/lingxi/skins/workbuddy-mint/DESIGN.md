# 薄荷值班 · 设计说明

WorkBuddy 的品牌皮肤。`skins.json` 是这一款的源记录；运行时读的是应用数据目录里那份
（由 `.workbuddy/probes/build-workbuddy-assets.mjs` 增量写入，见文末）。

## 为什么 `fur` 直接用品牌主色

皮肤里 `fur` 是**最大的一块面积**——整只猫的身体。所以"这是 WorkBuddy 的猫"这件事
必须由底色承担，而不是靠某个点缀色。`#0AC89F` 直接从应用图标取色，不做柔化：
柔化之后它就只是"一只青绿色的猫"，而这是品牌皮肤，识别优先。

其余九项按内置 `tuxedo` 皮肤（`ink-sesame` 芝麻夜航）的角色分工一一对应：

| 字段 | 颜色 | 用在哪 | 为什么是这个值 |
|---|---|---|---|
| `fur` | `#0AC89F` | 全身底色 | 品牌主色，不做柔化 |
| `pattern` | `#06806A` | 耳朵、眉、尾端暗部 | 同色相压暗，和底色是"同一只猫的深浅"而不是两种颜色 |
| `cream` | `#EDFBF6` | 胸口围嘴、肚皮 | 品牌浅色 `#E5F9F4` 提亮一档，在薄荷底上才够"云白" |
| `iris` | `#F2CD7A` | 虹膜 | 蜜金和青绿是补色——瞳色不给补色，眼睛就是一块死绿 |
| `pupil` | `#0A3A31` | 瞳孔 | 深墨绿，不是纯黑：黑色在绿毛里显脏 |
| `nose` | `#F0939C` | 鼻头 | 冷色身体需要一处暖色，否则整只猫是冷的 |
| `paw` | `#EDFBF6` | 四只爪子 | 和围嘴同色 = "白袜子"，`tuxedo` 的第二个白斑 |
| `mouth` | `#2F6F60` | 嘴线 | 深薄荷，保持同色系 |
| `whisker` | `#EDFBF6` | 胡须 | 浅色胡须在深绿底上才有线条感 |
| `tongue` | `#E998A6` | 舌头 | 和鼻头同族，唯一一处亮暖色 |

## WorkBuddy 定制套件的其余部分

皮肤只是这一套里用户一眼看到的那一件。同一个脚本还会写：

| 文件 | 内容 |
|---|---|
| `expressions.json` | 内置 30 个 + WorkBuddy 词汇 10 个（绿灯 / 红灯 / 上线 / 构建中 / 待你确认 / 排队中 / 超时 / 收工 / 待命 / 摸鱼） |
| `actions.json` | 内置 49 个 + `wb-deploy` / `wb-review` / `wb-suspend` / `wb-wave-flag`，全部放在 `特效` 分类——该分类永不被自动挑中，只能显式触发，正好是"agent 专用"该有的行为 |
| `bubble.json` | 深薄荷气泡 `#0B2B26` + 品牌色描边 |
| `reactions.json` | 任务 → 表情/动作映射，把上面那套词汇接到 `/task-event` 上；同时钉住 5 条按 `mood` 细分的内置情绪响应，避免品牌化顺手删掉"猫回应情绪"这件事 |

`actions.json` 和 `expressions.json` 是**整体替换**语义，所以脚本每次都先带全内置再追加；
`skins.json` 是**合并**语义，所以脚本先读现有的再增量写——一份不读就写的 `skins.json`
会把用户已有的皮肤从盘上抹掉。

## 重新生成 / 回退

```sh
# 生成（幂等；会先把现有 skins.json 快照到 ~/.lingxi/backup/）
node .workbuddy/probes/build-workbuddy-assets.mjs
# 用应用自己的 parser 预检，再让运行中的应用重读
node --experimental-strip-types .workbuddy/probes/verify-workbuddy-assets.mjs
lingxi reload && lingxi assets
```

回退：从 `~/.lingxi/backup/skins.json.pre-workbuddy-*` 恢复 `skins.json`，
删掉 `expressions.json` / `actions.json` / `bubble.json` / `reactions.json` 即回到内置，
然后 `lingxi reload`。切换皮肤需要 `trusted` 档位（`skin` 是会保存的设置），
或者由用户在外观页上自己点——自定义皮肤会以带标记的卡片出现在那里。
