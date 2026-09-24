// 生成「孙红雷猫」自定义皮肤包：faceSheet 表情脸谱 + 全身贴图（白衬衫/牛仔裤/大皮鞋）。
//
// 用法：node --experimental-strip-types scripts/make-sun-honglei-skin.mjs [输出目录]
// 输出：<outDir>/textures/sun-honglei-face.png（1024×512，4×2 格）
//       <outDir>/textures/sun-honglei-body.png（与骨架 atlas 布局逐面对应）
//
// 脸谱设计基准：贴花是 256×256 方图，贴在 8.6×7.8 的头部正面（屏幕上横向拉伸 ~1.10），
// 所以所有 x 坐标经 X() 预压缩，保证屏幕上是设计比例。
// 猫的身份保留：整张铺猫毛色 + 最后画奶油色猫胡子；孙红雷特征用漫画式夸张：
// 单眼皮缝状小眯眼、浓低直眉、高鼻梁大鼻子、宽嘴撇笑 + 深法令纹、黑色寸头。

import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeAtlasLayout, faceRects } from '../apps/lingxi/src/rig/atlas.ts';
import { refineSkeleton } from '../apps/lingxi/src/rig/anatomy.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 关键：渲染器用 refineSkeleton 精修后的骨架生成 atlas 布局，贴图必须按同一布局绘制，
// 否则全身 UV 全部错位（spine/neck/四肢/尾巴的盒子尺寸都被精修改过）。
const SKELETON = refineSkeleton(JSON.parse(readFileSync(join(ROOT, 'apps/lingxi/src/data/skeleton.json'), 'utf8')));
const OUT_DIR = process.argv[2] ?? join(process.env.HOME, 'Library/Application Support/com.dushaobin.lingxi-desktop/assets');

// ─── PNG 编码（无第三方依赖）─────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ─── 像素画布 ────────────────────────────────────────────────────────────────
function canvas(w, h) {
  return { w, h, px: Buffer.alloc(w * h * 4) };
}
function px(c, x, y, col) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  const [r, g, b, a = 1] = col;
  if (a >= 1) {
    c.px[i] = r; c.px[i + 1] = g; c.px[i + 2] = b; c.px[i + 3] = 255;
    return;
  }
  const da = c.px[i + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  c.px[i] = Math.round((r * a + c.px[i] * da * (1 - a)) / oa);
  c.px[i + 1] = Math.round((g * a + c.px[i + 1] * da * (1 - a)) / oa);
  c.px[i + 2] = Math.round((b * a + c.px[i + 2] * da * (1 - a)) / oa);
  c.px[i + 3] = Math.round(oa * 255);
}
function rect(c, x, y, w, h, col) {
  for (let yy = Math.round(y); yy < Math.round(y + h); yy += 1)
    for (let xx = Math.round(x); xx < Math.round(x + w); xx += 1) px(c, xx, yy, col);
}
function roundRect(c, x, y, w, h, rad, col) {
  const r = Math.min(rad, w / 2, h / 2);
  for (let yy = Math.floor(y); yy < y + h; yy += 1)
    for (let xx = Math.floor(x); xx < x + w; xx += 1) {
      const dx = Math.max(x + r - xx, xx - (x + w - 1 - r), 0);
      const dy = Math.max(y + r - yy, yy - (y + h - 1 - r), 0);
      if (dx * dx + dy * dy <= r * r + 0.6) px(c, xx, yy, col);
    }
}
function ellipse(c, cx, cy, rx, ry, col) {
  if (rx <= 0 || ry <= 0) return;
  for (let yy = Math.floor(cy - ry); yy <= Math.ceil(cy + ry); yy += 1)
    for (let xx = Math.floor(cx - rx); xx <= Math.ceil(cx + rx); xx += 1) {
      const dx = (xx - cx) / rx, dy = (yy - cy) / ry;
      if (dx * dx + dy * dy <= 1.08) px(c, xx, yy, col);
    }
}
function dot(c, x, y, r, col) { ellipse(c, x, y, r, r, col); }
function line(c, x1, y1, x2, y2, w, col) {
  const steps = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    dot(c, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, w / 2, col);
  }
}
function quadLine(c, x1, y1, qx, qy, x2, y2, w, col) {
  const steps = Math.max(4, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps, mt = 1 - t;
    dot(c, mt * mt * x1 + 2 * mt * t * qx + t * t * x2, mt * mt * y1 + 2 * mt * t * qy + t * t * y2, w / 2, col);
  }
}
const withA = (col, a) => [col[0], col[1], col[2], a];

// ─── 调色板 ──────────────────────────────────────────────────────────────────
const SKIN = [184, 130, 84];        // 黝黑麦色（主毛色=肤色）
const SKIN_DARK = [150, 100, 60];
const SKIN_LIGHT = [208, 158, 112];
const HAIR = [30, 22, 16];          // 黑色寸头
const BROW = [24, 16, 10];
const SCLERA = [238, 226, 204];
const IRIS = [56, 38, 24];
const LINE = [44, 27, 17];          // 五官深线
const NOSE_C = [138, 88, 54];
const NOSTRIL = [44, 29, 19];
const LIP = [164, 104, 72];
const WHISKER = [245, 233, 210];
const TEETH = [246, 240, 228];
const MOUTH_IN = [72, 40, 25];
const TONGUE = [224, 138, 146];
const TEAR = [150, 198, 214];
const BLUSH = [198, 120, 88];
const SHIRT = [246, 243, 236];
const SHIRT_SEAM = [230, 224, 212];
const SHIRT_FOLD = [219, 212, 199];
const DENIM = [61, 90, 120];
const DENIM_DARK = [40, 60, 84];
const DENIM_STITCH = [126, 154, 186];
const SHOE = [24, 25, 29];
const SHOE_HI = [62, 66, 76];
const SOLE = [38, 40, 46];
const EAR_PINK = [224, 156, 150];

// ─── 脸谱 ────────────────────────────────────────────────────────────────────
const CELL = 256;
const XS = 0.907; // 1/1.1026：抵消贴花在屏幕上的横向拉伸
const X = (x) => 128 + (x - 128) * XS;

/**
 * 画一张脸。
 * browL/browR: 'flat'|'raise'|'high'|'furrow'|'sad'
 * eye: 'half'|'grin'|'closed'|'round'|'tearful'
 * gaze: -1..1 瞳孔横向偏移；eyeH: 眼缝高度上限
 * mouth: 'smirk'|'grin'|'frown'|'o'|'flat'|'smile'；tear/blush: bool
 */
function drawFace(img, ox, oy, opts) {
  const c = { w: img.w, h: img.h, px: img.px }; // 借用整图像素，用偏移画
  const t = (x, y) => [ox + x, oy + y];
  const P = (x, y, col) => { const [tx, ty] = t(x, y); px(c, tx, ty, col); };
  const R = (x, y, w, h, col) => { const [tx, ty] = t(x, y); rect(c, tx, ty, w, h, col); };
  const RR = (x, y, w, h, rad, col) => { const [tx, ty] = t(x, y); roundRect(c, tx, ty, w, h, rad, col); };
  const EL = (x, y, rx, ry, col) => { const [tx, ty] = t(x, y); ellipse(c, tx, ty, rx, ry, col); };
  const LN = (x1, y1, x2, y2, w, col) => { const [ax, ay] = t(x1, y1); const [bx, by] = t(x2, y2); line(c, ax, ay, bx, by, w, col); };
  const QL = (x1, y1, qx, qy, x2, y2, w, col) => { const [ax, ay] = t(x1, y1), [bx, by] = t(x2, y2), [cx2, cy2] = t(qx, qy); quadLine(c, ax, ay, cx2, cy2, bx, by, w, col); };

  const { browL = 'flat', browR = 'flat', eye = 'half', gaze = 0.5, eyeH = 11, mouth = 'smirk', tear = false, blush = false } = opts;

  // 1) 底色 + 阴影（长方脸：只留下颌角阴影）
  R(0, 0, CELL, CELL, SKIN);
  R(0, 0, 8, CELL, withA(SKIN_DARK, 0.5));
  R(CELL - 8, 0, 8, CELL, withA(SKIN_DARK, 0.5));
  EL(X(34), 232, 18, 16, withA(SKIN_DARK, 0.22));
  EL(X(222), 232, 18, 16, withA(SKIN_DARK, 0.22));
  EL(X(128), 246, 38, 9, withA(SKIN_DARK, 0.18));

  // 2) 寸头：平直发际线 + 锯齿小缺口 + 鬓角，发际线偏高露额头
  RR(X(128) - 108, 2, 216, 30, 12, HAIR);
  R(X(20), 24, 216, 8, HAIR);
  R(X(52), 30, 12, 5, SKIN);   // 发际线缺口
  R(X(122), 31, 14, 5, SKIN);
  R(X(196), 30, 12, 5, SKIN);
  RR(X(12), 22, 14, 40, 5, HAIR);  // 鬓角
  RR(X(230), 22, 14, 40, 5, HAIR);

  // 3) 眉毛：粗、低、直，压着眼睛
  const browLift = { flat: 0, raise: -8, high: -14 };
  const drawBrow = (cx, style) => {
    const lift = browLift[style] ?? 0;
    const side = cx < 128 ? -1 : 1;
    if (style === 'furrow') {
      LN(X(cx - 25 * -side), 102, X(cx + 25 * -side), 112, 12, BROW);
    } else if (style === 'sad') {
      LN(X(cx - 25 * -side), 112, X(cx + 25 * -side), 100, 12, BROW);
    } else {
      LN(X(cx - 26), 104 + lift, X(cx + 26), 105 + lift, 12, BROW);
    }
    if (style === 'raise' || style === 'high') {
      QL(X(cx - 18), 87 + lift * 0.5, cx, 84 + lift * 0.5, X(cx + 18), 87 + lift * 0.5, 2.5, withA(SKIN_DARK, 0.5)); // 抬头纹
    }
  };
  drawBrow(62, browL);
  drawBrow(194, browR);

  // 4) 眼睛：梗图式眯眼——厚眼睑横条（外端下耙）+ 细黑暗缝，几乎无眼白
  const EY = 124;
  const eyeAt = (cx) => {
    const side = cx < 128 ? -1 : 1; // 外侧方向
    if (eye === 'grin') {
      QL(X(cx - 24), EY + 6, cx, EY - 15, X(cx + 24), EY + 6, 8, BROW); // 眯成缝的笑弧
      return;
    }
    if (eye === 'closed') {
      QL(X(cx - 21), EY - 2, cx, EY + 8, X(cx + 21), EY - 2, 6, BROW);
      return;
    }
    if (eye === 'round') {
      EL(cx, EY, 15, 13, LINE);
      EL(cx, EY, 13, 11, SCLERA);
      EL(cx + 4 * gaze, EY + 1, 5.5, 5, IRIS);
      EL(cx + 2 * gaze, EY - 1.5, 2, 2, TEETH);
      return;
    }
    if (eye === 'tearful') {
      RR(cx - 22, EY - 8, 44, 16, 8, SCLERA);
      LN(X(cx - 22), EY - 5, X(cx + 22), EY - 5, 7, BROW);
      EL(cx + 6 * gaze, EY + 2, 7, 6.5, IRIS);
      EL(cx + 3 * gaze, EY - 1, 2.5, 2.5, TEETH);
      EL(cx + 15, EY + 19, 4.5, 7.5, TEAR);
      return;
    }
    // half：厚睑条 + 黑缝 + 微露瞳
    const tilt = 3 * side; // 外端下耙
    LN(X(cx - 22), EY - 5 - tilt, X(cx + 22), EY - 5 + tilt, 7, BROW);      // 眼睑横条
    LN(X(cx - 19), EY + 1 - tilt * 0.6, X(cx + 19), EY + 1 + tilt * 0.6, 3.5, LINE); // 睑裂黑缝
    EL(cx + 6 * gaze, EY + 1, 6, 2.5, IRIS);                                 // 缝中微露的瞳
    EL(cx, EY + 8, 15, 2.5, withA(SKIN_LIGHT, 0.5));                         // 卧蚕
  };
  eyeAt(X(62));
  eyeAt(X(194));

  // 4.5) 猫的浅色口鼻区（muzzle）：把「人的五官」装进「猫的脸」结构里
  const MUZZLE = [199, 147, 101];
  RR(X(128) - 58, 140, 116, 96, 36, MUZZLE);
  EL(X(128), 232, 44, 16, MUZZLE); // 圆下巴融入

  // 5) 鼻子：emoji 式极简——软梁影 + 小鼻头 + 两个鼻孔弧线（全部无轮廓线）
  EL(X(128), 122, 8, 20, withA(SKIN_DARK, 0.14));            // 梁软影
  EL(X(128), 160, 13, 9, NOSE_C);                            // 小鼻头
  EL(X(128) - 4, 157, 6, 3, withA(SKIN_LIGHT, 0.6));         // 鼻头高光
  QL(X(128) - 16, 162, X(128) - 12, 168, X(128) - 6, 166, 2.5, NOSTRIL); // 鼻孔弧
  QL(X(128) + 16, 162, X(128) + 12, 168, X(128) + 6, 166, 2.5, NOSTRIL);

  // 6) 嘴：宽撇嘴（画在口鼻区内）+ 短法令纹
  const MY = 186;
  const nasolabial = (deep) => {
    const a = deep ? 0.6 : 0.45;
    QL(X(104), 168, X(99), 176, X(97), MY - 2, 3, withA(SKIN_DARK, a));
    QL(X(152), 168, X(157), 176, X(159), MY - 2, 3, withA(SKIN_DARK, a));
  };
  if (mouth === 'smirk') {
    QL(X(82), MY + 2, 128, MY + 10, X(164), MY - 2, 6, LINE);
    LN(X(164), MY - 2, X(176), MY - 9, 5, LINE);
    nasolabial(false);
    QL(X(110), MY + 9, 128, MY + 13, X(146), MY + 9, 3, withA(LIP, 0.85));
  } else if (mouth === 'grin') {
    nasolabial(true);
    RR(X(128) - 48, MY - 11, 96, 30, 15, MOUTH_IN);
    RR(X(128) - 40, MY - 8, 80, 11, 5, TEETH);
    EL(128, MY + 12, 17, 7, TONGUE);
  } else if (mouth === 'frown') {
    QL(X(90), MY + 10, 128, MY - 3, X(164), MY + 12, 6, LINE);
    nasolabial(true);
  } else if (mouth === 'o') {
    EL(128, MY + 3, 12, 15, MOUTH_IN);
    EL(128, MY + 9, 6.5, 5.5, withA(TONGUE, 0.8));
    nasolabial(false);
  } else if (mouth === 'flat') {
    RR(X(128) - 14, MY + 3, 28, 5, 2, LINE);
    nasolabial(false);
  } else if (mouth === 'smile') {
    QL(X(96), MY + 1, 128, MY + 10, X(160), MY + 1, 6, LINE);
    nasolabial(false);
  }

  // 8) 泪/腮红
  if (blush) {
    EL(X(40), 176, 13, 7, withA(BLUSH, 0.45));
    EL(X(216), 176, 13, 7, withA(BLUSH, 0.45));
  }
  if (tear) {
    EL(X(216), 150, 4.5, 7.5, TEAR);
  }

  // 9) 猫胡子（最后画——从口鼻区边缘向外长，保留猫的身份证）
  for (let i = 0; i < 3; i += 1) {
    const y = 172 + i * 11;
    QL(X(74), y, X(40), y + 3, X(8), y + 7 + i * 2, 3, withA(WHISKER, 0.95));
    QL(X(182), y, X(216), y + 3, X(248), y + 7 + i * 2, 3, withA(WHISKER, 0.95));
  }
}

// 8 个表情格子：0 平静面瘫 | 1 招牌眯眼笑 | 2 得意 | 3 不爽 | 4 惊 | 5 困 | 6 委屈 | 7 满足
const EXPRESSIONS = [
  { browL: 'flat', browR: 'flat', eye: 'half', gaze: 0.6, eyeH: 10, mouth: 'smirk' },
  { browL: 'raise', browR: 'raise', eye: 'grin', mouth: 'grin' },
  { browL: 'flat', browR: 'raise', eye: 'half', gaze: 1, eyeH: 9, mouth: 'smirk' },
  { browL: 'furrow', browR: 'furrow', eye: 'half', gaze: 1, eyeH: 8, mouth: 'frown' },
  { browL: 'high', browR: 'high', eye: 'round', gaze: 0, mouth: 'o' },
  { browL: 'flat', browR: 'flat', eye: 'closed', mouth: 'flat' },
  { browL: 'sad', browR: 'sad', eye: 'tearful', gaze: 0.3, mouth: 'frown', tear: true },
  { browL: 'raise', browR: 'raise', eye: 'grin', mouth: 'smile', blush: true },
];

// 内置 30 个表情名 → 格子
const CELL_MAP = {
  安然: 0, 认真: 0, 清醒: 0, 警惕: 3, 嫌弃: 3, 不爽: 3, 生气: 3,
  开心: 1, 喵喵: 1, 闪亮: 1, 玩心: 2, 得意: 2, 期待: 2, 左眼眨: 2, 右眼眨: 2,
  好奇: 4, 警觉: 4, 惊吓: 4, 困惑: 4,
  困困: 5, 闭眼休息: 5, 陶醉: 5,
  委屈: 6, 求抱抱: 6,
  放松: 7, 满足: 7, 安心: 7, 温柔: 7, 害羞: 7, 撒娇: 7,
};

function makeFaceSheet() {
  const img = canvas(CELL * 4, CELL * 2);
  EXPRESSIONS.forEach((opts, i) => {
    drawFace(img, (i % 4) * CELL, Math.floor(i / 4) * CELL, opts);
  });
  return img;
}

// ─── 身体贴图：与 atlas 布局逐面对应 ─────────────────────────────────────────
function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

function makeBodyAtlas() {
  const nodes = SKELETON.nodes;
  const layout = computeAtlasLayout(nodes, 4);
  const c = canvas(layout.size, layout.size);
  const faceFill = (faces, face, col) => {
    const [x, y, w, h] = faces[face];
    rect(c, x, y, w, h, col);
  };
  const band = (faces, face, v0, v1, col) => {
    const [x, y, w, h] = faces[face];
    rect(c, x, y + Math.round(h * v0), w, Math.max(1, Math.round(h * (v1 - v0))), col);
  };
  const vstitch = (faces, face, u, col) => {
    const [x, y, w, h] = faces[face];
    rect(c, x + Math.round(w * u), y, 1, h, col);
  };

  for (const node of nodes) {
    const region = layout.regions[node.id];
    if (!region) continue;
    const faces = faceRects(region);
    const id = node.id;
    const all = (col) => { for (const f of Object.keys(faces)) faceFill(faces, f, col); };

    if (/^(hipC|spine[0-4]|chest)$/.test(id)) {
      // 白衬衫躯干
      all(SHIRT);
      for (const f of ['px', 'nx']) { vstitch(faces, f, 0.16, SHIRT_SEAM); vstitch(faces, f, 0.84, SHIRT_SEAM); }
      band(faces, 'px', 0.86, 1, SHIRT_FOLD);
      band(faces, 'nx', 0.86, 1, SHIRT_FOLD);
      if (id === 'chest') band(faces, 'pz', 0, 0.14, SHIRT_SEAM); // 领口阴影
      // 前襟+纽扣画在腹面（ny）
      const [bx, by, bw, bh] = faces.ny;
      rect(c, bx + Math.round(bw / 2), by, 1, bh, SHIRT_SEAM);
      if (/^spine[123]$/.test(id)) {
        for (const v of [0.32, 0.68]) rect(c, bx + Math.round(bw / 2) - 1, by + Math.round(bh * v), 3, 2, [176, 168, 152]);
      }
    } else if (/^neck[12]$/.test(id)) {
      // 白衬衫领
      all(SHIRT);
      for (const f of ['px', 'nx', 'py']) band(faces, f, 0, 0.22, SHIRT_SEAM);
    } else if (id === 'head') {
      // 黑发 + 肤色
      for (const f of ['px', 'nx', 'pz', 'nz']) faceFill(faces, f, FUR);
      faceFill(faces, 'py', HAIR);
      faceFill(faces, 'ny', FUR);
      band(faces, 'px', 0, 0.22, HAIR);
      band(faces, 'nx', 0, 0.22, HAIR);
      faceFill(faces, 'nz', HAIR); // 后脑全黑发
    } else if (/^ear[LR]$/.test(id)) {
      all(FUR);
      // 内耳粉色只占正面中央一小块，耳朵整体保持毛色
      const [ex, ey, ew, eh] = faces.pz;
      faceFill(faces, 'pz', FUR);
      roundRect(c, ex + Math.round(ew * 0.26), ey + Math.round(eh * 0.24), Math.round(ew * 0.48), Math.round(eh * 0.56), 2, EAR_PINK);
      faceFill(faces, 'py', mix(FUR, [40, 26, 18], 0.55));
    } else if (/^tail\d$/.test(id)) {
      const t2 = parseInt(id.slice(4));
      // 尾巴保持毛色，只有尾尖两节加深（之前整条渐变太深，正面像根黑柱）
      all(t2 >= 5 ? mix(FUR, [104, 66, 40], 0.55) : FUR);
    } else if (/^(scap|upper[FR][LR]|lower[FR][LR])$/.test(id)) {
      // 白衬衫袖
      all(SHIRT);
      for (const f of ['px', 'nx']) { vstitch(faces, f, 0.25, SHIRT_SEAM); vstitch(faces, f, 0.75, SHIRT_SEAM); }
      if (/^lower/.test(id)) {
        for (const f of ['px', 'nx', 'pz', 'nz']) band(faces, f, 0.8, 1, SHIRT_FOLD);
      }
    } else if (/^(thigh|shin)[LR]$/.test(id)) {
      // 牛仔裤
      all(DENIM);
      for (const f of ['px', 'nx']) { vstitch(faces, f, 0.2, DENIM_STITCH); vstitch(faces, f, 0.8, DENIM_STITCH); }
      if (/^thigh/.test(id)) { for (const f of ['px', 'nx', 'py', 'pz', 'nz']) band(faces, f, 0, 0.14, DENIM_DARK); }
      if (/^shin/.test(id)) { band(faces, 'pz', 0.3, 0.5, mix(DENIM, [255, 255, 255], 0.12)); }
    } else if (/^(foot|paw|toe)/.test(id)) {
      // 大黑皮鞋
      all(SHOE);
      faceFill(faces, 'ny', SOLE);
      for (const f of ['px', 'nx']) { band(faces, f, 0.86, 1, SOLE); band(faces, f, 0.8, 0.86, [70, 74, 84]); }
      const [fx2, fy2, fw2, fh2] = faces.pz;
      roundRect(c, fx2 + Math.round(fw2 * 0.08), fy2 + Math.round(fh2 * 0.1), Math.round(fw2 * 0.84), Math.round(fh2 * 0.42), 3, SHOE_HI);
      const [tx, ty, tw, th] = faces.py;
      rect(c, tx + Math.round(tw * 0.3), ty + Math.round(th * 0.25), Math.round(tw * 0.4), Math.round(th * 0.5), SHOE_HI);
    } else if (id === 'tongue') {
      all([226, 134, 142]);
      const [gx, gy, gw, gh] = faces.py;
      rect(c, gx + Math.round(gw / 2), gy + 1, 1, Math.max(1, gh - 2), [178, 96, 106]);
    } else if (/^whisker/.test(id)) {
      all(WHISKER);
    } else if (/^eye[LR]$/.test(id)) {
      all(IRIS);
    } else if (id === 'nose') {
      all(NOSE_C);
    } else if (id === 'mouth') {
      all(LINE);
    } else {
      all(FUR);
    }
  }
  return { img: c, layout };
}

const FUR = SKIN;

// ─── 输出 ────────────────────────────────────────────────────────────────────
const face = makeFaceSheet();
const { img: body, layout } = makeBodyAtlas();

mkdirSync(join(OUT_DIR, 'textures'), { recursive: true });
const facePath = join(OUT_DIR, 'textures/sun-honglei-face.png');
const bodyPath = join(OUT_DIR, 'textures/sun-honglei-body.png');
writeFileSync(facePath, encodePNG(face.w, face.h, face.px));
writeFileSync(bodyPath, encodePNG(body.w, body.h, body.px));

const skin = {
  schemaVersion: 1,
  id: 'sun-honglei',
  name: '红雷大叔',
  description: '孙红雷 caricature：单眼皮缝状小眯眼、浓眉、高鼻梁大鼻子、招牌眯眼笑；白衬衫牛仔裤大皮鞋；保留猫耳猫尾猫胡子。',
  rigId: SKELETON.rigId ?? SKELETON.id,
  pattern: 'plain',
  materials: {
    fur: '#B88254', pattern: '#1E1610', cream: '#F5E9D2', iris: '#382618',
    pupil: '#241610', nose: '#8A5836', paw: '#F6F3EC', mouth: '#2C1B11',
    whisker: '#F5E9D2', tongue: '#E08A92',
  },
  proportions: {
    footL: { size: [3.2, 3.0, 3.2] },
    footR: { size: [3.2, 3.0, 3.2] },
  },
  bodyTexture: { png: 'sun-honglei-body.png' },
  faceSheet: { png: 'sun-honglei-face.png', columns: 4, rows: 2, cells: CELL_MAP, fallback: 0 },
};

// 更新 skins.json：保留其它自定义皮肤，替换旧的 sunhonglei-inspired
const skinsPath = join(OUT_DIR, 'skins.json');
let skins = [];
try { skins = JSON.parse(readFileSync(skinsPath, 'utf8')); } catch { skins = []; }
skins = skins.filter((s) => s.id !== 'sunhonglei-inspired' && s.id !== 'sun-honglei');
skins.push(skin);
writeFileSync(skinsPath, JSON.stringify(skins, null, 2) + '\n');

console.log(`face sheet : ${facePath} (${face.w}x${face.h}, 8 cells)`);
console.log(`body atlas : ${bodyPath} (${body.w}x${body.h}, atlas size ${layout.size})`);
console.log(`skins.json : ${skinsPath} -> [${skins.map((s) => s.id).join(', ')}]`);
