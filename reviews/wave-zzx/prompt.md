你是灵犀 3D 精模（Blender，仓库 /Users/liepin/workspace/lingxi-v5fix，分支 lookdev/b4-review）的调研与美术资源助手。方向：极度治愈、非常萌。

## 硬性规则
- **不要运行 Blender**（另一个进程正在独占跑 Blender，内存只有 16 GB）；不要改任何代码、json 配置或其他文件；不要 git 提交。
- 只允许写下面列出的输出文件。

## 背景
当前模型 Round ZZW（提交 84817be）：幼猫比例（头 1.10）、侧卧已改成目标朝向、真地面。codex 阶段审计 `reviews/STAGE-ZZQ-AUDIT-2026-10-15.md` 的前 8 项里，剩下：表情区分度与笑眼拱（#2）、胸/颊/尾局部毛量（#3）、侧卧舒展与翻肚白腹（#4）、舔侧身露脸与舔爪接触（#5）、趾缝深度（#6）、起跳后蹬与伸懒腰幅度（#7）。
关键发现：我们的翻肚是从**正面机位（仰角 20°）**看的，而 `lingxi-ref-act-belly-up.png` 是俯拍，机位不同无法对照；桌宠实际只用正面机位。

## 任务 A：同机位目标图（gpt-image / imagegen，各 1024×1024，写实毛发摄影风格，无文字）
以附带的我们自己的渲染为模板，**保持同一机位、同一画幅、同一地面与灯光方向**，同一只猫（暖棕虎斑、白胸白爪、大黑瞳橄榄虹膜、粉鼻、闭口"人"字嘴、幼猫大圆头），只改姿态：
1. `assets/characters/lingxi/reference/lingxi-ref-ourcam-belly-up.png`：模板 `round-zzv/fc31/belly-up.png`（正面机位）。完全仰躺翻肚，身体略向镜头倾、白肚皮大面积朝向镜头，头转过来看镜头，四爪松松蜷在胸腹上方，身体 C 形微弯，尾巴卷在地上。要从这个低机位也一眼读出"翻肚撒娇"。
2. `assets/characters/lingxi/reference/lingxi-ref-ourcam-groom-side.png`：模板 `round-zzv/fc31/groom-side.png`。坐着回头舔侧腹，但从这个机位能看到**一只完整的眼睛和鼻尖**，舌尖贴在侧腹毛上。
3. `assets/characters/lingxi/reference/lingxi-ref-ourcam-sidelie.png`：模板 `round-zzw/fcv/sidelie-app.png`。同朝向（头右尾左、肚皮朝镜头）的放松侧躺，身体更长更舒展、胸更低贴地，后腿向左伸开平放在地上，前爪并排在前。
生成后自己核对：花色、脸、机位、地线与模板一致；不一致就重画（最多各 2 次）。

## 任务 B：调研报告 `reviews/wave-zzx/codex-research.md`（中文）
读 `scripts/blender/build_lingxi_v5.py`（相关块：`BU=`、`GS=`、`SIDELOUNGE=`、`V6_TOE_CLEFT`、跳跃 `_jump_key`/Jump、Stretch 的 `BOW_*`、毛发 `groom(`、`V6_CHEEK_FLUFF`、`V6_LEN_*`）和附图，为每个剩余问题给出：
- 根因（引用代码行号与参数名）；
- **具体的参数改法**（旋钮名、现值 → 建议值或搜索区间、预期效果），优先用已有 `_v6('V6_...')` 旋钮；需要新代码的写清楚改哪里、怎么改（伪代码即可）；
- 可量的验收方法和门槛（像素或毫米，注明机位）；
- 风险与需回归的动作。
按"对治愈与萌的影响 ÷ 改动成本"排序。

## 任务 C：表情提案 `reviews/wave-zzx/face-controls-proposal.json`
读 `assets/characters/lingxi/v6/round-zzw/face-controls.json`（30 个表情的面部控制映射）和附图 `expr-zzp.jpg`（现状 30 格）。审计指出好奇、玩心、期待、清醒等多格只差瞳孔或嘴点，笑眼弧度弱。输出一份**结构完全相同**的修改版 json（只改数值，不增删键），让 30 个表情在 200 px 小图里也能一眼区分；同时在 codex-research.md 末尾列出每个改动的表情、改了哪些键、为什么。闭口嘴形必须保持"人"字向下，不要把嘴角改上翘；笑眼是干净的上拱闭眼线，不要让下睑鼓成浅色圆包。
