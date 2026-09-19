# 🐱 Peipei Desktop Demo
## Three.js + Blender + Native Desktop

---

# 0. Demo 的目标

第一版 Demo 不追求：

- AI 聊天
- 长期记忆
- 复杂行为系统
- 100 个动作
- 完整 360° 游戏角色

我们只验证一件事：

> **陪陪真的出现在用户桌面上以后，会不会让用户感觉它“活着”？**

---

# 1. Demo 最终效果

用户打开应用。

桌面右下角：

```text
┌──────────────────────────────────────┐
│                                      │
│                                      │
│                                      │
│                              🐱      │
│                            陪陪       │
└──────────────────────────────────────┘
```

陪陪：

- 趴在那里
- 有呼吸
- 会眨眼
- 耳朵偶尔动
- 尾巴偶尔摆
- 鼠标经过时看一眼
- 偶尔换一个姿势
- 用户不操作时自己睡觉

重点：

> 它不是一个窗口里的 3D 模型。

而是：

> **像一只猫真的趴在你的电脑桌面上。**

---

# 2. 推荐总体架构

```text
                    ┌───────────────┐
                    │    Desktop    │
                    │     Shell     │
                    └───────┬───────┘
                            │
                            ▼
                  Transparent Window
                            │
                            ▼
                    ┌─────────────┐
                    │   React     │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Three.js   │
                    │             │
                    │   Renderer  │
                    │   Camera    │
                    │   Lights    │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ Peipei.glb  │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼

       Skeleton         Animation        Material
```

---

# 3. 技术选型

我建议：

## Desktop

```text
Tauri
```

或者你现在提到的“小奥式桌面悬浮方案”作为 Shell。

Shell 只负责：

```text
透明窗口

无边框

置顶

鼠标穿透

拖动

系统 API

开机启动
```

---

## Frontend

```text
React
```

---

## 3D

```text
Three.js
```

建议：

```text
@react-three/fiber
```

原因：

你本身熟悉 React。

所以：

```text
React

↓

React Three Fiber

↓

Three.js
```

开发效率最高。

---

## Asset

```text
Blender

↓

GLB
```

---

## Animation

第一阶段：

```text
Blender Animation

↓

GLB Animation Clips

↓

Three.js AnimationMixer
```

---

# 4. 项目目录

建议直接这样建立：

```text
peipei-desktop/

├── apps/
│
│   ├── desktop/
│   │
│   │   ├── src/
│   │   │
│   │   ├── src-tauri/
│   │   │
│   │   └── package.json
│
│   └── web/
│
├── packages/
│
│   ├── character/
│   │
│   │   ├── model/
│   │   │   └── peipei.glb
│   │
│   │   ├── animations/
│   │   │
│   │   └── textures/
│   │
│   ├── renderer/
│   │
│   └── behavior/
│
└── assets/
```

MVP 甚至可以更简单：

```text
src/

├── App.tsx

├── scene/
│   ├── Peipei.tsx
│   ├── Camera.tsx
│   ├── Lights.tsx
│   └── Scene.tsx
│
├── animation/
│   ├── AnimationController.ts
│   └── IdleSystem.ts
│
├── interaction/
│   └── MouseTracker.ts
│
└── behavior/
    └── CatState.ts
```

---

# 5. 最重要的问题：猫应该用什么角度？

这是我认为整个项目里**最容易做错的地方**。

很多人做桌宠会这样：

```text
正面

🐱
```

或者：

```text
完全侧面

🐈
```

我认为都不对。

---

# 我的推荐：

# ⭐ 默认使用「3/4 前视角」

大约：

```text
Camera
    \
     \
      🐱
     ↗
```

猫身体：

# 15°～25° 偏转

头部：

可以独立转动。

---

视觉类似：

```text
       👀

      /🐱
     /  🐱
        🐾
```

不是：

```text
正面：

   👀
  🐱
```

也不是：

```text
侧面：

🐈 →
```

---

# 6. 为什么 3/4 角最适合陪陪？

因为：

## ① 用户能看到两只眼睛

眼睛是：

> 情绪价值的主要来源。

如果完全侧面：

```text
👁️
```

你只看到一只眼睛。

情绪连接明显下降。

---

## ② 可以看到身体体积

完全正面：

```text
🐱
```

很可爱。

但是容易：

> 像头像。

3/4：

```text
     🐱
   🐱🐱
 🐾
```

用户可以看到：

- 脸
- 胸口
- 身体
- 前爪
- 尾巴

生命感更强。

---

## ③ 毛发层次最好

3/4 角度可以看到：

```text
脸颊毛

↓

胸毛

↓

身体

↓

尾巴
```

这正好是陪陪最治愈的部分。

---

## ④ 适合 Head Tracking

身体：

```text
固定
```

头：

```text
←
→
↑
↓
```

用户移动鼠标：

```text
Mouse

↓

Eyes Look

↓

Head Rotate

↓

Ear React
```

非常自然。

---

# 7. 我建议的默认 Pose

不要让陪陪：

```text
站着
```

也不要：

```text
坐得笔直
```

第一版最佳：

# ⭐ 趴着

类似：

```text
          🐱
        ／
   🐾🐾────
        🐱🐱
```

身体低。

前爪放在前面。

头稍微抬起来。

---

原因：

## ① 更自然

猫真正的日常状态：

```text
趴

睡

洗脸

发呆
```

---

## ② 更稳定

桌面宠物不是：

```text
游戏 NPC
```

不需要一直移动。

---

## ③ 更容易治愈

用户看到：

```text
工作

↓

抬头

↓

🐱 正在趴着
```

比：

```text
🐱🧍
```

更舒服。

---

# 8. 默认构图

假设陪陪在右下角。

我建议：

```text
┌─────────────────────────────┐
│                             │
│                             │
│                             │
│                             │
│                        👀   │
│                     🐱🐱    │
│                   🐾        │
└─────────────────────────────┘
```

重点：

# 不要放在最底部。

需要留一点：

```text
Ground Space
```

让猫感觉：

> 有重量。

---

# 9. Ground Contact Shadow

这是非常重要的。

透明窗口里的猫，如果：

```text
🐱

没有阴影
```

会变成：

> 飘着。

所以必须有：

# Fake Contact Shadow

```text
       🐱
    🐾🐾

   ▓▓▓▓▓
```

阴影：

- 很软
- 很淡
- 很小

作用：

> 把猫固定在桌面上。

---

Three.js 中建议：

```text
透明 PNG Shadow
```

或者：

```text
Shadow Plane
```

不要做复杂实时阴影。

MVP：

```text
Soft Shadow Texture
```

就够。

---

# 10. 相机方案

我建议：

# PerspectiveCamera

不要 Orthographic。

原因：

真实感。

---

推荐初始参数：

```text
FOV

25 ~ 35
```

不要：

```text
FOV 60
```

会导致：

> 猫头变大。

---

建议：

```text
Camera
Position

0
1.2
4.5
```

根据模型调整。

---

Camera：

```text
LookAt

0
0.8
0
```

---

目标：

# Portrait Lens Feeling

有一点：

```text
摄影感
```

而不是：

```text
游戏视角
```

---

# 11. Blender 模型坐标标准

这个一定要从第一天统一。

Blender：

```text
        Z
        ↑
        │
        │
        └────→ X
       /
      Y
```

建议：

```text
Ground

Z = 0
```

猫的：

```text
Paw

Z = 0
```

---

模型：

```text
Origin

Ground Center
```

不要：

```text
Origin

Head
```

否则 Three.js：

```text
Position
```

非常难控制。

---

# 12. Blender 建模阶段

我建议分：

# Phase A

Base Mesh

只做：

```text
Head

Body

Legs

Tail
```

不要毛。

---

# Phase B

Face Detail

重点：

```text
Eyes

Nose

Mouth

Ear
```

---

# Phase C

Fur Direction

先定义：

```text
Face

→

Body

→

Tail
```

毛发方向。

---

# Phase D

Runtime Optimization

输出：

```text
Low Poly Mesh

+

Texture

+

Hair Cards
```

---

# 13. Blender 文件结构

建议：

```text
peipei_master.blend
```

里面：

```text
COLLECTIONS

├── MODEL
│
│   ├── Body
│   ├── Head
│   ├── Eyes
│   ├── Nose
│   └── Fur
│
├── RIG
│
│   └── Armature
│
├── ANIMATION
│
│   ├── Idle
│   ├── Sleep
│   └── Look
│
└── EXPORT
```

---

# 14. Runtime 模型目标

不要一开始：

```text
1,000,000 polygons
```

桌宠完全没必要。

建议 MVP：

```text
Body

20k ~ 50k triangles
```

Hero 区域：

```text
Face
```

可以高一点。

---

总目标：

```text
50k ~ 100k triangles
```

已经足够。

---

# 15. 毛发技术方案

这里非常关键。

我建议：

# 不做 Blender Groom 直接导出。

因为：

```text
Blender Fur

↓

GLB

↓

💥
```

兼容性不好。

---

推荐：

# Hybrid Fur Runtime

```text
Base Mesh
```

↓

```text
Fur Texture
```

+

```text
Normal Map
```

+

关键区域：

```text
Hair Cards
```

---

Hair Cards 用在：

```text
脸颊

耳朵

胸口

尾巴

爪子
```

---

结构：

```text
          Ear Fur

        ////////

       🐱

   Cheek Fur

    /////////

      Body
   Texture Fur

        Tail

   ////////////
```

---

# 16. 第一版动画设计

第一版：

# 只做 8 个 Animation Clips

不要 25 个。

---

## 01 Idle

```text
Idle
```

基础趴着。

长度：

```text
30 ~ 60 sec
```

---

## 02 Blink

```text
Blink
```

独立。

长度：

```text
0.2 sec
```

---

## 03 Look Left

---

## 04 Look Right

---

## 05 Ear Twitch

---

## 06 Tail Move

---

## 07 Sleep

---

## 08 Stretch

---

重点：

# Idle 不应该做成一个动画。

应该：

```text
Base Idle

+

Blink

+

Ear

+

Tail

+

Head
```

组合。

---

# 17. Animation Layer

这是 Demo 的关键。

```text
Base Animation

↓

Idle
```

上面：

```text
Additive Layer
```

例如：

```text
Head

Rotate
```

---

再上：

```text
Eye
```

---

最终：

```text
              Eyes
                ↓

              Head
                ↓

Base Idle ← Animation System → Tail
                ↓

              Ears
```

---

# 18. Three.js Animation Architecture

建议：

```text
Peipei
│
├── AnimationMixer
│
├── BaseAction
│
├── HeadController
│
├── EyeController
│
├── EarController
│
└── TailController
```

---

不要：

```text
if mouse
 play animation
```

应该：

```text
Mouse Position

↓

Normalized Target

↓

Target Head Rotation

↓

Smooth Damp

↓

Bone Rotation
```

---

# 19. 鼠标看向系统

用户鼠标：

```text
Screen

X
Y
```

转换：

```text
Normalized

-1 ~ 1
```

---

例如：

```text
Mouse Left

Head Y

-15°
```

---

```text
Mouse Right

Head Y

15°
```

---

```text
Mouse Up

Head X

-5°
```

---

最大：

```text
Head Rotation

X

±10°

Y

±25°
```

不要太大。

否则：

```text
👀
```

会像恐怖谷。

---

# 20. 正确的注视顺序

非常重要：

## 第一阶段

```text
Eyes
```

立即：

```text
0 ~ 100ms
```

---

## 第二阶段

```text
Head
```

延迟：

```text
100 ~ 300ms
```

---

## 第三阶段

```text
Ear
```

低概率。

---

也就是说：

```text
Mouse

↓

Eyes

↓

Head

↓

Ear
```

不是：

```text
Mouse

↓

整个猫转过来
```

---

# 21. 鼠标不要 100% 跟踪

建议：

```text
Ignore

40%
```

---

```text
Eye Look

35%
```

---

```text
Head Look

20%
```

---

```text
Full Interest

5%
```

否则：

> 用户会觉得被监控。

---

正确感觉应该：

```text
“它偶尔注意到我”
```

而不是：

```text
“它一直盯着我”
```

---

# 22. 猫的默认方向

如果陪陪放：

# 右下角

我建议：

猫身体：

```text
向左前方
```

原因：

用户视觉中心：

```text
←
```

猫应该：

```text
🐱 ←
```

有一点：

# 看向屏幕中心

---

如果：

# 左下角

镜像：

```text
→ 🐱
```

---

所以：

# 猫不是固定世界角度。

而是：

```text
Position

↓

Determine Facing Direction
```

---

规则：

```text
Bottom Right

Face Center Left
```

---

```text
Bottom Left

Face Center Right
```

---

# 23. 最佳视觉角度

我建议：

## Body

```text
Yaw

20°
```

朝向：

屏幕中心。

---

## Head

默认：

```text
5°
```

稍微偏回来。

---

## Camera

略高：

```text
5° ~ 10°
```

看向猫。

---

最终效果：

```text
Camera

      ↓

     👀
      \
       🐱
     🐾🐾
```

这会形成：

# Slight Top-down 3/4

---

这是我认为最适合：

> 桌面陪伴。

的角度。

---

# 24. 为什么不做猫眼高度 Camera？

因为用户实际是在：

```text
看屏幕
```

不是：

```text
趴在地上看猫
```

所以 Camera 需要：

```text
Slightly Above
```

---

但是不能：

```text
45°
```

否则：

像：

```text
监控摄像头
```

---

最佳：

```text
5° ~ 12°
```

---

# 25. Lighting

透明桌宠最大问题：

# 环境不统一。

用户可能：

```text
深色壁纸
```

也可能：

```text
白色网页
```

---

所以不能完全依赖：

```text
Environment Light
```

---

建议：

# Self-contained Lighting

---

## Key Light

方向：

```text
Top Left
```

强度：

```text
1.0
```

---

## Fill Light

```text
Front
```

强度：

```text
0.3
```

---

## Rim Light

```text
Back
```

非常弱。

---

目的：

让猫：

```text
任何背景
```

都能看清。

---

# 26. 推荐 Three.js Scene

```text
Scene
│
├── Camera
│
├── Lights
│   │
│   ├── Key
│   ├── Fill
│   └── Rim
│
├── Peipei
│
└── Shadow
```

---

# 27. Three.js Renderer

核心：

```text
alpha: true
```

透明。

---

Canvas：

```text
background:

transparent
```

---

目标：

```text
Desktop

+

Three.js Cat
```

用户只看到：

```text
🐱
```

看不到：

```text
黑色矩形
```

---

# 28. Desktop Window

建议窗口：

```text
Transparent

Frameless

Always On Top
```

---

初始：

```text
400 × 400
```

或者：

```text
500 × 500
```

---

注意：

不要：

```text
Full Screen Transparent Window
```

第一版。

因为：

- 鼠标事件复杂
- 性能浪费
- 系统兼容复杂

---

应该：

```text
Small Floating Window
```

窗口：

```text
┌─────────────┐
│             │
│     🐱      │
│             │
└─────────────┘
```

背景：

透明。

---

# 29. 鼠标穿透

桌宠平时：

```text
Click Through
```

用户可以：

```text
点击桌面

点击 App

点击网页
```

猫不会挡住。

---

鼠标进入猫附近：

```text
Interaction Mode
```

可以：

```text
Hover

Pet

Drag
```

---

建议状态：

```text
PASS_THROUGH
```

↓

鼠标进入 Hit Area：

```text
INTERACTIVE
```

↓

离开：

```text
PASS_THROUGH
```

---

# 30. Hit Area 不要等于窗口

推荐：

```text
Window

500 × 500
```

但是：

```text
Interactive Zone

Cat Mesh Bounds
```

---

否则：

用户点击：

```text
透明区域
```

也会被挡住。

体验很差。

---

# 31. Demo Behavior System

第一版：

不用 LLM。

直接：

```text
Finite State Machine
```

---

状态：

```text
IDLE
```

↓

```text
LOOK
```

↓

```text
RELAX
```

↓

```text
SLEEP
```

↓

```text
STRETCH
```

---

结构：

```text
              IDLE
             /    \
            /      \
         LOOK      RELAX
           │         │
           │         │
         IDLE      SLEEP
                      │
                      ▼
                   STRETCH
                      │
                      ▼
                     IDLE
```

---

# 32. Cat State

建议：

```text
type CatState = {

  energy

  curiosity

  comfort

  sleepiness

}
```

---

MVP：

```text
energy: 0.7

curiosity: 0.5

comfort: 0.9

sleepiness: 0.3
```

---

行为：

```text
if sleepiness > 0.8

→ SLEEP
```

---

```text
if mouseNear

→ LOOK
```

---

```text
if idle > randomTime

→ Ear Twitch
```

---

# 33. Idle Engine

不要固定：

```text
every 5 sec

blink
```

应该：

```text
Random Range
```

---

例如：

## Blink

```text
2 ~ 8 sec
```

随机。

---

## Ear

```text
5 ~ 30 sec
```

随机。

---

## Tail

```text
10 ~ 40 sec
```

随机。

---

## Head Move

```text
20 ~ 60 sec
```

随机。

---

## Sleep Transition

```text
3 ~ 15 min
```

随机。

---

# 34. Random 不等于完全随机

应该：

```text
Weight
```

例如：

```text
Blink

80%
```

---

```text
Ear Twitch

40%
```

---

```text
Look Around

30%
```

---

```text
Wash

10%
```

---

```text
Unexpected Action

2%
```

---

这样用户会：

> 不知道下一秒它会干什么。

但又不会：

> 完全不符合猫的行为。

---

# 35. Demo 第一批动作

我建议最终：

# 8 个

---

## 1

Idle Lie

核心。

---

## 2

Blink

---

## 3

Look

---

## 4

Ear Twitch

---

## 5

Tail Move

---

## 6

Sleep

---

## 7

Stretch

---

## 8

Head Tilt

---

就够了。

---

# 36. Blender Animation

每个 Action：

```text
Action Name
```

例如：

```text
IDLE_LIE
```

---

```text
SLEEP
```

---

```text
STRETCH
```

---

```text
EAR_TWITCH
```

---

```text
TAIL_IDLE
```

---

导出：

```text
peipei.glb
```

里面：

```text
Scene

+

Mesh

+

Skeleton

+

Animations
```

---

# 37. GLB 验收

导出 Blender 前：

```text
Apply Transform
```

---

Scale：

```text
1
```

---

Rotation：

```text
0
```

---

然后：

```text
Export

GLB
```

---

必须验证：

```text
GLB Viewer
```

确认：

```text
✓ Model

✓ Texture

✓ Skeleton

✓ Animation

✓ Scale
```

---

# 38. Three.js Character Component

结构：

```text
<Peipei>
```

内部：

```text
GLTFLoader

↓

Model

↓

AnimationMixer

↓

Bone References

↓

Animation Controller
```

---

Bone 引用：

```text
head

leftEar

rightEar

tail

spine
```

---

React：

```text
useFrame(() => {

  updateAnimation()

  updateHead()

  updateEyes()

  updateTail()

})
```

---

# 39. Animation Controller

建议：

```text
AnimationController
```

负责：

```text
Play

CrossFade

Stop

Transition
```

---

例如：

```text
IDLE
```

↓

用户长时间不动：

```text
crossFade

↓

SLEEP
```

---

而不是：

```text
STOP IDLE

PLAY SLEEP
```

---

Transition：

```text
0.5 ~ 1 sec
```

---

# 40. Head Controller

独立。

```text
Mouse

↓

Target Rotation

↓

Smooth Damp

↓

Head Bone
```

---

不要：

```text
直接 rotation = target
```

---

需要：

```text
Lerp
```

或者：

```text
Spring
```

---

推荐：

```text
Damping
```

效果：

```text
鼠标

↓

眼睛

↓

0.2 秒

↓

头

↓

慢慢停止
```

---

# 41. Eye System

MVP 不需要真正复杂的眼球 Shader。

先：

```text
Eye Bone
```

或者：

```text
Morph
```

---

第一版：

```text
Eye Left

Eye Right
```

---

Rotation：

```text
X

Y
```

---

最大：

```text
±10°
```

---

不要太大。

猫眼：

```text
眼神移动
```

应该比：

```text
人类
```

克制。

---

# 42. 呼吸系统

MVP：

不需要完整动画。

可以：

```text
Spine Bone
```

做：

```text
sin(time)
```

---

例如：

```text
scale

1.0

↓

1.01

↓

1.0
```

---

时间：

```text
3 ~ 5 sec
```

---

睡觉：

```text
4 ~ 6 sec
```

---

非常微弱。

---

如果用户：

> 第一眼就看到呼吸。

说明太大了。

正确：

> 看了一会以后感觉它在呼吸。

---

# 43. Tail Controller

尾巴建议：

```text
Tail Root

↓

Tail 1

↓

Tail 2

↓

Tail 3
```

---

使用：

```text
Sine Wave
```

+

```text
Noise
```

---

例如：

```text
Root

小

Middle

中

Tip

大
```

---

最终：

```text
～～～
```

不是：

```text
←→←→←→
```

---

# 44. 耳朵

耳朵必须：

```text
Independent
```

---

左耳：

```text
随机
```

右耳：

```text
随机
```

---

不要：

```text
两个耳朵完全同步
```

否则：

> 像机器人。

---

# 45. Desktop Position

默认：

# Bottom Right

---

但建议：

```text
Screen Safe Area
```

考虑：

```text
Dock

Taskbar

Screen Edge
```

---

例如 macOS：

```text
Dock Bottom
```

则：

```text
Cat Y

↑
```

自动抬高。

---

# 46. Position System

建议：

```text
DesktopAnchor

BOTTOM_RIGHT
```

---

未来：

```text
BOTTOM_LEFT

TOP_RIGHT

CUSTOM
```

---

但是 Demo：

```text
只做 Bottom Right
```

---

# 47. 猫和 Dock 的关系

这里我有一个很重要的产品建议。

陪陪不要：

```text
浮在空中
```

最好：

> 看起来像趴在 Dock 上面。

视觉：

```text
      🐱

──────────────────
        Dock
```

---

即使实际上：

```text
透明窗口
```

也要做：

```text
Ground Illusion
```

---

因为：

```text
猫 + Surface
```

比：

```text
猫 + 空气
```

真实感强很多。

---

# 48. Demo 推荐角度方案

最终我推荐：

# Peipei Desktop Camera v1

---

## Cat Body

```text
Yaw

20°
```

朝屏幕中心。

---

## Head

```text
Yaw

-5°
```

稍微回看用户。

---

## Camera

```text
Height

+8°
```

略高。

---

## Lens

```text
FOV

30°
```

---

## Distance

保证：

```text
Head

25%
```

---

```text
Body

50%
```

---

```text
Paw

15%
```

---

```text
Tail

10%
```

---

这个比例我认为：

# 最治愈。

---

# 49. 为什么不做全身？

如果：

```text
全身
```

在窗口：

```text
500px
```

里。

猫会太小。

用户看到：

```text
🐈
```

---

而不是：

```text
🐱👀
```

---

陪伴感主要来自：

```text
Eyes

Face

Paw

Fur
```

---

所以：

# 上半身优先。

---

# 50. 推荐构图

```text
┌─────────────────────┐


        👂 👂

          👀

       🐱🐱

      🐾 🐾

       🐱


──────────────────────
```

---

画面占比：

```text
Cat

65 ~ 75%
```

---

留白：

```text
25 ~ 35%
```

---

不要：

```text
90%
```

太压迫。

---

# 51. 性能目标

Demo：

```text
FPS

60
```

---

Idle：

```text
CPU

< 3%
```

---

GPU：

```text
< 10%
```

---

Memory：

```text
< 300MB
```

---

# 52. 渲染优化

暂停：

```text
Window Hidden
```

↓

```text
Stop Rendering
```

---

用户：

```text
Screen Locked
```

↓

```text
Sleep Renderer
```

---

FPS：

```text
Active

60
```

---

Idle：

```text
30
```

甚至：

```text
20
```

---

Sleep：

```text
10 ~ 20
```

---

# 53. Demo 开发顺序

我建议严格按照这个顺序。

---

# Day 1

## Desktop Shell

完成：

```text
透明窗口

置顶

右下角
```

---

验收：

桌面上：

```text
透明窗口
```

可以浮着。

---

# Day 2

## Three.js

完成：

```text
Canvas

Transparent

Camera

Light
```

---

先放：

```text
Cube
```

---

不要马上放猫。

---

# Day 3

## Import GLB

完成：

```text
Peipei.glb

↓

Three.js
```

---

验收：

```text
🐱
```

正确显示。

---

# Day 4

## Camera

调整：

```text
3/4 View
```

---

这个阶段非常重要。

可以：

```text
连续调 2 小时
```

直到：

> 第一眼舒服。

---

# Day 5

## Lighting

做：

```text
Key

Fill

Rim
```

---

加：

```text
Contact Shadow
```

---

# Day 6

## Animation

接入：

```text
Idle
```

---

# Day 7

加入：

```text
Blink
```

---

# Day 8

加入：

```text
Head Look
```

---

# Day 9

加入：

```text
Ear
```

---

# Day 10

加入：

```text
Tail
```

---

# Day 11

加入：

```text
Sleep
```

---

# Day 12

加入：

```text
Random Idle
```

---

# Day 13

加入：

```text
Mouse Interaction
```

---

# Day 14

## Demo

完成。

---

# 54. 第一版 Demo Scope

最终：

```text
🐱 Peipei
```

---

支持：

```text
✓ Transparent Desktop

✓ Always On Top

✓ 3/4 Camera

✓ Idle

✓ Blink

✓ Breath

✓ Ear

✓ Tail

✓ Mouse Look

✓ Sleep

✓ Random Behavior
```

---

不支持：

```text
✗ AI Chat

✗ Voice

✗ Long Memory

✗ Walking

✗ Full Physics

✗ Multi Cat
```

---

# 55. Demo 的核心成功标准

不要问：

> 技术实现了吗？

要问：

---

## Test 01

用户工作：

```text
30 min
```

之后：

抬头：

```text
🐱
```

有没有觉得：

> 它一直在那里。

---

## Test 02

猫突然：

```text
👂
```

耳朵动一下。

用户有没有：

> 注意到它。

---

## Test 03

鼠标经过。

猫：

```text
👀
```

看一眼。

用户有没有：

> 感觉它知道我在这里。

---

## Test 04

用户想关闭 Demo。

有没有：

> 有点舍不得。

---

如果有。

这个项目：

# 值得继续。

---

# 56. 我认为真正的核心技术

不是：

```text
Three.js
```

不是：

```text
Blender
```

甚至不是：

```text
LLM
```

而是：

# Micro Life

也就是：

```text
呼吸

眨眼

耳朵

尾巴

眼神

停顿

随机
```

这些：

```text
微小行为
```

组合起来。

---

最终：

```text
3D Model

+

Animation

=

好看的猫
```

但是：

```text
3D Model

+

Animation

+

Micro Behavior

+

Randomness

+

Context

=

陪陪
```

---

# 57. 最终技术架构

```text
                    PEIPEI
                      🐱
                       │
        ┌──────────────┴──────────────┐
        │                             │
        ▼                             ▼

   Visual Engine                 Life Engine

        │                             │

        ▼                             ▼

    Three.js                     Cat State

        │                             │

        ▼                             ▼

      GLB                      Behavior

        │                             │

        ▼                             ▼

    Animation                  Intent

        │                             │

        └──────────────┬──────────────┘
                       │
                       ▼

                Desktop Shell

                       │
                       ▼

                  macOS Desktop
```

---

# 58. MVP 最终技术栈

```text
Desktop

Tauri
```

+

```text
Frontend

React
```

+

```text
3D

Three.js
```

+

```text
React 3D

React Three Fiber
```

+

```text
Asset

Blender
```

+

```text
Format

GLB
```

+

```text
Animation

Blender Action

+

Three.js Mixer
```

+

```text
Behavior

Custom State Machine
```

---

# 59. 下一阶段

完成 Demo 后：

```text
Peipei Demo v0.1
```

↓

验证：

```text
视觉治愈感
```

↓

进入：

```text
v0.2
```

增加：

```text
Cat Life Engine
```

↓

然后：

```text
v0.3
```

增加：

```text
AI Personality
```

↓

最后：

```text
Peipei
```

成为真正：

# Desktop Companion