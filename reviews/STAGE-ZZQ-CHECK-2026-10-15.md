# 阶段验收（Round ZZQ，a4d8497）——Claude 书面审计

codex 审计（`reviews/stage-zzq/prompt.md`）因额度用尽未产出（日志：until 2026-10-15 00:41），恢复后重跑；本文件是 Claude 对同一组对照的判定。
对照：`reviews/stage-zzq/stage-{a,b,c,d}.jpg`（31 机位，左 codex 目标 | 右 ZZQ，串行渲染 `v6/round-zzq/fc31/`），表情 `expr-zzp.jpg`。

## 四个维度（与 10-14 审计同一尺度）

| 维度 | 10-14 审计 | ZZQ | 依据 |
|---|---|---|---|
| 表情 | 2.5 | 3.5 | 安然 / 认真圆瞳、友好表情瞳孔放大；笑眼是干净的闭眼线（无浅色圆鼓）；嘴为参考的"人"字 + 粉色下唇；负面表情耳朵不再摊平。剩：笑眼拱比目标低；表情之间区分度仍偏低。 |
| 身体比例 | 正 4 / 侧 2 | 正 4 / 侧 2 | 未改——侧面仍是成年猫（体长、头小、头与背平齐）。幼猫比例是最后一项。 |
| 动作协调 | 机械 4.5 / 表演 2.5 | 机械 4.5 / 表演 3.5 | 伸懒腰鞠躬、洗脸爪到脸前、舔侧身回头、转身着地、翻肚横躺、坐姿类贴地、蜷睡尾环、侧卧后半身、挠耳前掌。剩：跑 / 跳的伸展与蹬地读数（受腿长限制）。 |
| 治愈与萌 | 3 | 3.5 | 翻肚与侧卧不再"摔倒 / 划水"；眼神温顺；蜷睡、正面趴 / 坐 / 揣手接近目标。上限受侧面体型限制。 |

## 31 组判定

- 达标或接近：stand-app、sit-front、sit-back、loaf、liedown-app、lie-front-low、lie-back、sleep-app、sleep-top、belly-up、wash-face、lick-paw、stretch（深胸限制下）、turn、scratch-ear、paw-front。
- 接近但有已知剩余：sidelie-app / -top（镜像、前腿伸得远）、groom-side（正面多为头顶）、paw-side（长坡、粉色肉垫露出）、sit-hindfoot（正侧面看不出分趾）、jump-crouch / -air / -land。
- 未达（体型）：stand-side、sit-side、liedown-side、liedown-top、run-ext、run-gat、jump-takeoff——身体长、头小、头低；均归入幼猫比例。

## 阶段结论

除"幼猫比例"及其附带的跑 / 跳外，批次 27 与审计其余问题均已完成或记录为已知剩余；阶段验收通过，进入幼猫比例。
幼猫目标：现有 codex 姿态目标图本身就是幼猫（大头、短身、头高于肩线），先从 `lingxi-ref-pose-stand-side` / `-stand-app` / `-sit-side` / `-pose-liedown-side` 的侧影量出头 / 体、肩高 / 体、前腿 / 体、胸深 / 肩高等比值，作为改比例的靶子；codex 额度恢复后补本体型的幼猫目标图与比例方案。
