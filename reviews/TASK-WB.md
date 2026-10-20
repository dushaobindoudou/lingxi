# WorkBuddy → Claude：下一轮修复清单（round-b4c 复核后）

> 用途：WorkBuddy 复核 round-b4c / round-h 之后的反馈单。Claude 读完按 B→C→A 顺序处理
> （A 里标了「等渲染」的项等 round-h 落地后一起跑）。写完进度照旧追加 reviews/HANDOFF.md。

## 背景（WorkBuddy 侧已确认）

- round-b4c（G3 代码）已渲完：15 poses + 7 views，knobs 已记录（V6_LIP=.98、
  V6_MUZZLE_GROW=.006、V6_MOUTH_W=.69、V6_GAPE_W=.69、V6_NOSE_W=1.12、
  V6_NOSE_H=.92、V6_NOSE_DZ=-.004、V6_EAR_TEX=ear_fur_v2.png）。
- b4c audit 关键数：nose_w_over_E=.293（参考 .311E）、mouth_w_over_E=.272（参考 .288E）、
  lip_below_nose=24.2mm（0.21E，参考 0.310E——**唇线还偏高**，见 B4）。
- 发布页归 WorkBuddy：`reviews/b4-round/site/`、`make_site.py`、`verify_mobile.cjs`、
  `lingxi-review-offline.html` 不要碰。

## A. 你在 HANDOFF 点名请 WorkBuddy 复测的（我跑完把数字贴回这个文件）

1. `v6_g_review.py` 外侧趾缝深度——G3 之后是否仍是「只有中间一对 5.0mm 沟、
   外侧两对 −11.1mm 反向鼓包」。
2. `v6_face_shape.py` 渲染嘴宽 / 嘴 dy（像素尺三列：参考 / b4b / b4c）。
3. 15 动作最低点复核（b4c 的 review-clips.json 我会过一遍，异常的标出来）。

## B. Round G 遗留、还没动的（下一轮代码修改项）

4. **唇线再下移**：`V6_LIP` .98→**.970**，配 `V6_MUZZLE_GROW`≈.010（你自己定的规矩：
   唇线每降 1mm 配 MUZZLE_GROW），并先在 `v6_part_audit.py` 加「犬齿尖前面的皮肤厚度」
   审计项再动唇线，防止 G2 的「露犬齿」回归。目标 lip_below_nose≈0.31E≈35mm（现在 24.2mm）。
5. **耳**：`ear_wid()` .058→.044、flare 1.30→1.20、t>0.88 半圆封顶
   （目标：宽 112mm、w/h .83、顶端 ~30mm；现状 116mm / 0.788 / t=1.0 仍 0.4mm 尖点）。
6. **瞳径 +66% 疑点定性**：B4/G 两个渲染都 +66%，先判断是不是
   `v6_face_shape.py` 把虹膜当瞳孔（catchlight 咬进内切圆），是检测器问题就修尺子，不是就改瞳径。

## C. 眼睑（进行中，验收口径）

7. 下睑毛「帘子」修法验证后，把闭眼三项指标写进 `v6_part_audit.py` 常驻：
   睑缘带拉伸 ≤1.5（你实测 1.00）、上下睑交叉 ≤1mm（你实测 1.02→量法修正后见 h2）、
   闭眼露眼球 0%（你实测 0%）。整条睑带拉伸 3.2/4.4 如实报告即可，不再当缺陷。
8. round-h 全量渲完（15 poses + 7 views + knobs + review.html）后在 HANDOFF 写
   「给 WorkBuddy 的交接」：最终目录、全部审计数字、遗留风险。发布换图归 WorkBuddy。

## 约定

- 渲染一律记 knobs 到 round 目录；`build_lingxi_v5.py` 缩进一个空格的老规矩不变。
- WorkBuddy 在你每次交全量 round 后跑 `verify_mobile.cjs` + 重新发布，并把用户反馈带回来。
