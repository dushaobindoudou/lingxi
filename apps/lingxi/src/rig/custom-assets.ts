// User-editable assets: the clip library, the expression set, and the theme catalogue, each
// loadable from a JSON file in the app's config directory instead of the bundle.
//
// The design rule throughout: VALIDATE COMPLETELY BEFORE SWAPPING ANYTHING IN. A hand-edited
// file is going to be wrong sometimes, and the failure mode for "wrong" must be "the built-in
// version keeps working and you get told why", never a cat with no face or a joint bent
// through its own body. So every loader here returns either a fully-checked value or an error
// string; there is no partial application.
//
// Why separate files and not one: they are edited for different reasons and by different
// people. Someone adding a theme should not have to scroll past two thousand lines of
// keyframes, someone retiming an animation should not risk breaking the face, and someone who
// just wants a darker speech bubble should not have to open either.
import { layers, expressions as builtInExpressions, DEFAULT_FACE_GEOMETRY, type FaceGeometry, type FaceState } from './art.ts';
import type { ArtSkin } from './art.ts';
import type { VoxelSkin } from './skeleton.ts';
import { parseMotions, type Motion } from '../anim/motion.ts';
import type { BubbleStyle } from '../fx/stage-fx.ts';

export interface CustomAssetPayload {
  available?: boolean;
  dir?: string;
  actions?: unknown;
  expressions?: unknown;
  skins?: unknown;
  bubble?: unknown;
  face?: unknown;
  /** filename -> data URL (PNG) or parsed JSON (a sidecar texture config). */
  textures?: Record<string, unknown>;
}

export interface LoadedAssets {
  actions?: Motion[];
  expressions?: Record<string, FaceState>;
  skins?: ArtSkin[];
  bubble?: Partial<BubbleStyle>;
  face?: FaceGeometry;
  /** Problems found, one per file. Surfaced in the UI rather than swallowed. */
  errors: string[];
  dir?: string;
}

const LAYER_NAMES = Object.keys(layers) as (keyof typeof layers)[];

/**
 * An expression is exactly one choice from each of the five face layers. Validated strictly -
 * a typo'd layer value would otherwise silently render as "nothing", which looks like the face
 * painter is broken rather than like the file has a typo in it.
 */
export function parseExpressions(value: unknown): Record<string, FaceState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('表情文件必须是一个对象：{ "表情名": { eye, brow, mouth, ear, symbol } }');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 200) throw new Error('需要 1–200 个表情');
  const result: Record<string, FaceState> = {};
  for (const [name, raw] of entries) {
    if (!name.trim() || name.length > 24) throw new Error(`表情名不合法：${name}`);
    if (!raw || typeof raw !== 'object') throw new Error(`${name} 必须是对象`);
    const face = raw as Record<string, string>;
    const built: Partial<FaceState> = {};
    for (const layer of LAYER_NAMES) {
      const choice = face[layer];
      const allowed = layers[layer] as readonly string[];
      if (typeof choice !== 'string' || !allowed.includes(choice)) {
        throw new Error(`${name}.${layer} 必须是以下之一：${allowed.join(' / ')}`);
      }
      (built as Record<string, string>)[layer] = choice;
    }
    result[name] = built as FaceState;
  }
  return result;
}

/**
 * Speech-bubble styling. Every field is optional - a file that only sets a colour keeps the
 * defaults for everything else, because the common case is wanting one thing different rather
 * than wanting to specify a whole design system.
 */
export function parseBubbleStyle(value: unknown): Partial<BubbleStyle> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('气泡样式必须是一个对象');
  }
  const raw = value as Record<string, unknown>;
  const out: Partial<BubbleStyle> = {};

  for (const key of ['background', 'text', 'accentText', 'border'] as const) {
    if (raw[key] === undefined) continue;
    const colour = raw[key];
    // Any CSS colour is allowed (named, rgb(), gradients would not work on a border but do on a
    // background), so this only rejects the obviously-not-a-colour.
    if (typeof colour !== 'string' || !colour.trim() || colour.length > 120) {
      throw new Error(`${key} 必须是 CSS 颜色字符串`);
    }
    out[key] = colour.trim();
  }

  const numbers: [keyof BubbleStyle, number, number][] = [
    ['borderWidth', 0, 12],
    ['radius', 0, 60],
    ['fontSize', 9, 48],
    ['fontWeight', 100, 900],
  ];
  for (const [key, min, max] of numbers) {
    if (raw[key] === undefined) continue;
    const n = Number(raw[key]);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${key} 需要在 ${min}–${max} 之间`);
    (out as Record<string, number>)[key] = n;
  }

  if (raw.fontFamily !== undefined) {
    const family = raw.fontFamily;
    if (typeof family !== 'string' || !family.trim() || family.length > 200) {
      throw new Error('fontFamily 必须是 CSS font-family 字符串');
    }
    // Rejected because it would escape the declaration and let a font name inject CSS.
    if (/[;{}]/.test(family)) throw new Error('fontFamily 不能包含 ; { }');
    out.fontFamily = family.trim();
  }

  if (raw.shape !== undefined) {
    const shapes = ['round', 'rect', 'cloud', 'spiky'];
    if (typeof raw.shape !== 'string' || !shapes.includes(raw.shape)) {
      throw new Error(`shape 只能是：${shapes.join(' / ')}`);
    }
    out.shape = raw.shape as BubbleStyle['shape'];
  }

  if (raw.shadow !== undefined) {
    if (typeof raw.shadow !== 'boolean') throw new Error('shadow 必须是 true 或 false');
    out.shadow = raw.shadow;
  }

  return out;
}

/** A custom face image, laid out as a grid of expression cells. */
export interface FaceSheet {
  /** Data URL of the PNG. */
  src: string;
  columns: number;
  rows: number;
  /** Expression name -> cell index, reading left-to-right, top-to-bottom. */
  cells: Record<string, number>;
  /** Cell used for any expression not in `cells`. */
  fallback: number;
}

export interface CustomSkin extends ArtSkin {
  /** Optional hand-painted body atlas, replacing the generated one. */
  bodyTexture?: { src: string; config?: unknown };
  /** Optional hand-drawn face sheet, replacing the procedural face painter. */
  faceSheet?: FaceSheet;
}

/**
 * Themes. The colour fields are required (they are what the generated pattern painter uses,
 * and what the UI shows as swatches); the texture fields are optional and let a theme replace
 * the generated art entirely with hand-painted PNGs.
 */
export function parseSkins(value: unknown, textures: Record<string, unknown>, rigId: string): CustomSkin[] {
  if (!Array.isArray(value)) throw new Error('皮肤文件必须是一个数组');
  if (value.length < 1 || value.length > 60) throw new Error('需要 1–60 款皮肤');
  const seen = new Set<string>();
  const REQUIRED_MATERIALS = ['fur', 'pattern', 'cream', 'iris', 'pupil', 'nose', 'paw', 'mouth', 'whisker', 'tongue'];

  return value.map((raw, index) => {
    const skin = raw as Record<string, unknown>;
    const id = skin.id;
    if (typeof id !== 'string' || !/^[-a-z0-9]{1,40}$/.test(id)) {
      throw new Error(`第 ${index + 1} 款皮肤的 id 不合法（只能是小写字母、数字、连字符）`);
    }
    if (seen.has(id)) throw new Error(`皮肤 id 重复：${id}`);
    seen.add(id);
    if (typeof skin.name !== 'string' || !skin.name.trim() || skin.name.length > 24) {
      throw new Error(`${id} 的 name 不合法`);
    }
    if (skin.rigId !== undefined && skin.rigId !== rigId) {
      throw new Error(`${id} 的 rigId 必须是 ${rigId}`);
    }
    const materials = skin.materials;
    if (!materials || typeof materials !== 'object') throw new Error(`${id} 缺少 materials`);
    for (const key of REQUIRED_MATERIALS) {
      const colour = (materials as Record<string, unknown>)[key];
      if (typeof colour !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(colour)) {
        throw new Error(`${id}.materials.${key} 必须是 #RRGGBB 形式的颜色`);
      }
    }

    const result: CustomSkin = {
      schemaVersion: 1,
      id,
      name: skin.name as string,
      description: typeof skin.description === 'string' ? skin.description : '',
      rigId,
      pattern: typeof skin.pattern === 'string' ? skin.pattern : 'tabby',
      materials: materials as Record<string, string>,
    };

    if (skin.hiddenNodes !== undefined) {
      if (!Array.isArray(skin.hiddenNodes) || !skin.hiddenNodes.every((node) => typeof node === 'string' && node.length > 0)) {
        throw new Error(`${id}.hiddenNodes 必须是非空字符串数组`);
      }
      result.hiddenNodes = [...new Set(skin.hiddenNodes as string[])];
    }

    // --- optional hand-painted body atlas ---
    if (skin.bodyTexture !== undefined) {
      const spec = skin.bodyTexture as Record<string, unknown>;
      const png = spec?.png;
      if (typeof png !== 'string') throw new Error(`${id}.bodyTexture.png 必须是 textures/ 下的文件名`);
      const src = textures[png];
      if (typeof src !== 'string') throw new Error(`${id} 找不到贴图 textures/${png}`);
      result.bodyTexture = {
        src,
        config: typeof spec.config === 'string' ? textures[spec.config as string] : undefined,
      };
    }

    // --- optional hand-drawn face sheet ---
    if (skin.faceSheet !== undefined) {
      const spec = skin.faceSheet as Record<string, unknown>;
      const png = spec?.png;
      if (typeof png !== 'string') throw new Error(`${id}.faceSheet.png 必须是 textures/ 下的文件名`);
      const src = textures[png];
      if (typeof src !== 'string') throw new Error(`${id} 找不到表情图 textures/${png}`);
      const columns = Number(spec.columns ?? 1);
      const rows = Number(spec.rows ?? 1);
      if (!Number.isInteger(columns) || columns < 1 || columns > 16) throw new Error(`${id}.faceSheet.columns 需要 1–16`);
      if (!Number.isInteger(rows) || rows < 1 || rows > 16) throw new Error(`${id}.faceSheet.rows 需要 1–16`);
      const cells: Record<string, number> = {};
      const map = (spec.cells ?? {}) as Record<string, unknown>;
      for (const [name, cell] of Object.entries(map)) {
        const n = Number(cell);
        if (!Number.isInteger(n) || n < 0 || n >= columns * rows) {
          throw new Error(`${id}.faceSheet.cells.${name} 超出了 ${columns}x${rows} 的格子范围`);
        }
        cells[name] = n;
      }
      const fallback = Number(spec.fallback ?? 0);
      if (!Number.isInteger(fallback) || fallback < 0 || fallback >= columns * rows) {
        throw new Error(`${id}.faceSheet.fallback 超出格子范围`);
      }
      result.faceSheet = { src, columns, rows, cells, fallback };
    }

    // --- optional proportion overrides (体型参数, e.g. a bigger pair of shoes) ---
    if (skin.proportions !== undefined) {
      const raw = skin.proportions as Record<string, unknown>;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(`${id}.proportions 必须是对象`);
      }
      const entries = Object.entries(raw);
      if (entries.length > 60) throw new Error(`${id}.proportions 最多 60 个部位`);
      const proportions: NonNullable<VoxelSkin['proportions']> = {};
      for (const [node, override] of entries) {
        if (!/^[A-Za-z][-A-Za-z0-9]{0,23}$/.test(node)) {
          throw new Error(`${id}.proportions 的部位名不合法：${node}`);
        }
        if (!override || typeof override !== 'object' || Array.isArray(override)) {
          throw new Error(`${id}.proportions.${node} 必须是对象`);
        }
        const record = override as Record<string, unknown>;
        const built: { size?: [number, number, number]; segmentLength?: number } = {};
        for (const key of Object.keys(record)) {
          if (key !== 'size' && key !== 'segmentLength') {
            throw new Error(`${id}.proportions.${node}.${key} 不是可调项，可用的是：size / segmentLength`);
          }
          if (key === 'size') {
            const size = record.size;
            if (
              !Array.isArray(size) || size.length !== 3 ||
              !size.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0.2 && v <= 16)
            ) {
              throw new Error(`${id}.proportions.${node}.size 必须是三个 0.2–16 的数字`);
            }
            built.size = [size[0] as number, size[1] as number, size[2] as number];
          } else {
            const length = record.segmentLength;
            if (typeof length !== 'number' || !Number.isFinite(length) || length < 0.2 || length > 16) {
              throw new Error(`${id}.proportions.${node}.segmentLength 需要 0.2–16 的数字`);
            }
            built.segmentLength = length;
          }
        }
        proportions[node] = built;
      }
      result.proportions = proportions;
    }

    return result;
  });
}

/**
 * Load whatever the user has put in the assets folder. Each file is independent: a broken
 * skins.json does not stop custom actions from loading, and every failure is reported rather
 * than silently dropped.
 */
/**
 * Face geometry - where the eyes, nose, mouth and whiskers sit and how big they are.
 *
 * Every field is optional and falls back to the built-in value, so a file that only widens the
 * eye spacing is a two-line file. Ranges are generous but bounded: the face texture is 256x256
 * and a value outside it does not produce an interesting cat, it produces an invisible feature
 * and a confused user.
 */
function parseFaceGeometry(raw: unknown): FaceGeometry {
  if (typeof raw !== 'object' || raw == null || Array.isArray(raw)) {
    throw new Error('应该是一个对象，可以只写想改的部分');
  }
  const input = raw as Record<string, Record<string, unknown> | undefined>;
  const known = ['muzzle', 'eyes', 'nose', 'mouth', 'whiskers'];
  for (const key of Object.keys(input)) {
    if (!known.includes(key)) {
      throw new Error(`未知的部位 "${key}"，可用的是：${known.join(' / ')}`);
    }
  }
  const out: FaceGeometry = structuredClone(DEFAULT_FACE_GEOMETRY);
  for (const group of known as (keyof FaceGeometry)[]) {
    const supplied = input[group];
    if (supplied == null) continue;
    if (typeof supplied !== 'object' || Array.isArray(supplied)) {
      throw new Error(`${group} 应该是一个对象`);
    }
    const target = out[group] as Record<string, number>;
    for (const [field, value] of Object.entries(supplied)) {
      if (!(field in target)) {
        throw new Error(`${group}.${field} 不是可调项，可用的是：${Object.keys(target).join(' / ')}`);
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${group}.${field} 应该是一个数字，收到 ${JSON.stringify(value)}`);
      }
      // The face texture is 256x256; anything outside that draws off the head.
      if (value < -128 || value > 256) {
        throw new Error(`${group}.${field} = ${value} 超出脸部贴图范围（-128 到 256）`);
      }
      target[field] = value;
    }
  }
  if (out.whiskers.rows < 0 || out.whiskers.rows > 8) {
    throw new Error(`whiskers.rows = ${out.whiskers.rows}，应该在 0 到 8 之间`);
  }
  return out;
}

export function loadCustomAssets(
  payload: CustomAssetPayload,
  context: { nodeIds: readonly string[]; poseNames: readonly string[]; rigId: string },
): LoadedAssets {
  const loaded: LoadedAssets = { errors: [], dir: payload.dir };
  if (!payload?.available) return loaded;
  const textures = payload.textures ?? {};

  // Expressions first: actions reference expressions by name, so they have to be validated
  // against whatever set is actually going to be in effect.
  let expressionNames = Object.keys(builtInExpressions);
  if (payload.expressions != null) {
    try {
      loaded.expressions = parseExpressions(payload.expressions);
      expressionNames = Object.keys(loaded.expressions);
    } catch (error) {
      loaded.errors.push(`expressions.json：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (payload.actions != null) {
    try {
      loaded.actions = parseMotions(payload.actions, context.nodeIds, expressionNames, context.poseNames);
    } catch (error) {
      loaded.errors.push(`actions.json：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (payload.bubble != null) {
    try {
      loaded.bubble = parseBubbleStyle(payload.bubble);
    } catch (error) {
      loaded.errors.push(`bubble.json：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (payload.face != null) {
    try {
      loaded.face = parseFaceGeometry(payload.face);
    } catch (error) {
      loaded.errors.push(`face.json：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (payload.skins != null) {
    try {
      loaded.skins = parseSkins(payload.skins, textures, context.rigId);
    } catch (error) {
      loaded.errors.push(`skins.json：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return loaded;
}

/** Written into the assets folder so the formats are documented where they are edited. */
export const ASSETS_README = `# 灵犀 · 自定义资源

这个目录里的文件可以直接编辑，保存后在「主界面 → 外观 → 重新加载自定义资源」点一下即可生效，
不需要重新编译。**每个文件都会先完整校验再生效**：格式不对时会保留内置版本并在界面上显示原因，
不会出现半张脸或者关节拧断的情况。

## actions.json —— 动作库

\`\`\`jsonc
{
  "schemaVersion": 2,
  "actions": [
    {
      "id": "my-stretch",          // 小写字母/数字/连字符
      "name": "我的伸懒腰",         // ≤ 40 字
      "category": "伸展",           // 休息 / 清洁 / 伸展 / 尾巴 / 互动 / 探索 / 玩耍 / 特效
      "description": "…",
      "duration": 4,                // 0.2–30 秒
      "priority": 30,               // 0–100
      "expression": "满足",         // 必须是 expressions.json 里存在的名字
      "tracks": [
        { "channel": "pose.stretch", "keys": [[0, 0], [1, 0.7], [3, 0.7], [4, 0]] },
        { "channel": "head.rotation.x", "keys": [[0, 0], [1, -0.2], [4, 0]] }
      ]
    }
  ]
}
\`\`\`

**通道 (channel) 可以是：**
- \`<骨骼>.rotation.<x|y|z>\` 或 \`<骨骼>.position.<x|y|z>\`，骨骼名见调试台
- \`pose.<sit|crouch|loaf|tuck|stretch|curl>\` —— 整体姿势混合，0–1
- \`face.blink\` / \`face.tongue\` / \`face.open\` / \`groom.paw\` / \`groom.wash\` —— 0–1

**每条轨道必须从 \`[0, 0]\` 开始、在 \`[duration, 0]\` 结束**（动作结束要回到中立姿态，否则和别的
动作叠加时会漂移）。关键帧 2–128 个，时间必须递增。

\`category\` 决定它什么时候会被自动挑中：\`特效\` 分类**永远不会**被自动播放，只能显式触发，
适合放大招。不碰腿部骨骼的动作可以在走路时播放，碰腿的会等它停下来。

## expressions.json —— 表情

每个表情就是五个图层各选一个：

\`\`\`json
{
  "我的开心": { "eye": "happy", "brow": "raise", "mouth": "cat", "ear": "forward", "symbol": "none" }
}
\`\`\`

可选值在调试台的「表情」页里可以逐个点开看实际效果。

## bubble.json —— 说话气泡的样式

只写你想改的字段，其余保持默认：

\`\`\`json
{
  "background": "#1e1e28",
  "text": "#f0e6ff",
  "border": "#8f7fd8",
  "borderWidth": 3,
  "radius": 20,
  "fontFamily": "\"LXGW WenKai\", \"PingFang SC\", sans-serif",
  "fontSize": 16,
  "fontWeight": 500,
  "shape": "round",
  "shadow": true
}
\`\`\`

\`shape\` 可选：
- \`round\` 普通气泡（默认）
- \`rect\` 直角框
- \`cloud\` 思考气泡（尾巴是两个小圆点）
- \`spiky\` 爆炸框（喊话／生气）

颜色接受任意 CSS 颜色写法。字体用系统里装好的字体名即可。

## skins.json —— 主题（皮肤）

\`\`\`jsonc
[
  {
    "id": "my-cat",
    "name": "我家的猫",
    "description": "一句话描述",
    "pattern": "tabby",            // tabby / point / solid / bicolor / tuxedo / atelier-*
    "hiddenNodes": ["earL", "earR"], // 可选：从轮廓中隐藏骨骼节点（人物化皮肤可去掉猫耳/尾巴）
    "materials": {                 // 全部必填，#RRGGBB
      "fur": "#E29A46", "pattern": "#B97835", "cream": "#F3E2C4",
      "iris": "#F2E7C9", "pupil": "#2E2118", "nose": "#DE8C8C",
      "paw": "#F3E2C4", "mouth": "#5A2A2A", "whisker": "#F3E2C4", "tongue": "#E88AA0"
    },

    // 可选：用手绘 PNG 完全替换生成的身体贴图
    "bodyTexture": { "png": "my-cat.png", "config": "my-cat.json" },

    // 可选：用手绘表情图替换程序绘制的脸
    "faceSheet": {
      "png": "my-face.png",
      "columns": 6, "rows": 5,     // 按从左到右、从上到下编号
      "cells": { "安然": 0, "开心": 1, "生气": 7 },
      "fallback": 0                // 没列出的表情用哪一格
    }
  }
]
\`\`\`

PNG 放在 \`textures/\` 子目录里，用文件名引用。\`bodyTexture.config\` 是可选的 UV 配置
（\`format: "lingxi-texture"\`），不写就按整图铺展。

## 想从内置资源改起？

「主界面 → 外观 → 导出内置资源为模板」会把当前内置的三个文件写到这里，直接改就行。
`;
