// 生成 WorkBuddy 主题的自定义资源包。
// 动作库 / 表情集是「整体替换」，所以必须先把内置的完整带上，再追加新的。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root = two levels up from .workbuddy/probes/. Never a hard-coded home directory: the probe
// has to run on whoever checked the repo out, not only on the machine it was written on.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(process.env.HOME, 'Library/Application Support/com.dushaobin.lingxi-desktop/assets');

// WorkBuddy 品牌色：从 /Applications/WorkBuddy.app/Contents/Resources/icon.icns 提取，
// 主色 #0AC89F（占比 23.1%），浅色 #E5F9F4。
const B = {
  mint: '#0AC89F', mintDeep: '#067F66', mintSoft: '#4FCBAE', mintPale: '#E8FAF5',
  ink: '#10312B', gold: '#F2CD7A', rose: '#F0939C', plum: '#5C3A3D',
};

fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- 表情
// 从 art.ts 提取内置 30 个（避免手抄出错）
const artSrc = fs.readFileSync(path.join(REPO, 'apps/lingxi/src/rig/art.ts'), 'utf8');
const block = artSrc.match(/BUILT_IN_EXPRESSIONS[^{]*\{([\s\S]*?)\n\};/)[1];
const builtIn = {};
const re = /'([^']+)':\s*\{\s*eye:'([^']+)',\s*brow:'([^']+)',\s*mouth:'([^']+)',\s*ear:'([^']+)',\s*symbol:'([^']+)'\s*\}/g;
let m;
while ((m = re.exec(block))) {
  builtIn[m[1]] = { eye: m[2], brow: m[3], mouth: m[4], ear: m[5], symbol: m[6] };
}
const builtInCount = Object.keys(builtIn).length;
if (builtInCount !== 30) throw new Error(`内置表情提取到 ${builtInCount} 个，期望 30 —— 提取逻辑要改`);

// WorkBuddy 专属表情：给 agent 的驱动词汇表
const wbExpressions = {
  '待命':     { eye: 'round',      brow: 'flat',   mouth: 'cat',   ear: 'forward',  symbol: 'none' },
  '排队中':   { eye: 'half',       brow: 'flat',   mouth: 'flat',  ear: 'neutral',  symbol: 'sleep' },
  '构建中':   { eye: 'slit',       brow: 'flat',   mouth: 'flat',  ear: 'forward',  symbol: 'sweat' },
  '绿灯':     { eye: 'sparkle',    brow: 'raise',  mouth: 'cat',   ear: 'forward',  symbol: 'exclaim' },
  '红灯':     { eye: 'wide',       brow: 'furrow', mouth: 'frown', ear: 'airplane', symbol: 'anger' },
  '上线':     { eye: 'happy',      brow: 'raise',  mouth: 'cat',   ear: 'forward',  symbol: 'heart' },
  '待你确认': { eye: 'round',      brow: 'raise',  mouth: 'flat',  ear: 'forward',  symbol: 'question' },
  '超时':     { eye: 'half',       brow: 'sad',    mouth: 'frown', ear: 'back',     symbol: 'sweat' },
  '收工':     { eye: 'closed',     brow: 'none',   mouth: 'cat',   ear: 'neutral',  symbol: 'heart' },
  '摸鱼':     { eye: 'wink-left',  brow: 'raise',  mouth: 'tongue',ear: 'forward',  symbol: 'none' },
};
const expressions = { ...builtIn, ...wbExpressions };
fs.writeFileSync(path.join(OUT, 'expressions.json'), JSON.stringify(expressions, null, 2) + '\n');

// ---------------------------------------------------------------- 动作
// 动作库是整体替换：先把内置 49 个原样带上
const builtInActions = JSON.parse(fs.readFileSync(path.join(REPO, 'apps/lingxi/src/data/actions.json'), 'utf8'));
const builtInActionCount = builtInActions.actions.length;

// WorkBuddy 专属动作，全部放在「特效」分类 —— 该分类永不被自动挑中，只能显式触发，
// 正好是「agent 专用」该有的行为。
const wbActions = [
  {
    id: 'wb-deploy', name: '部署上线', category: '特效',
    description: '起跳、抬头、尾巴立起 —— 一次成功的发布',
    duration: 3.5, priority: 70, expression: '上线',
    tracks: [
      { channel: 'root.position.y', keys: [[0, 0], [0.5, 0.85], [1.15, 0], [3.5, 0]] },
      { channel: 'head.rotation.x', keys: [[0, 0], [1.3, -0.28], [1.8, 0.08], [3.5, 0]] },
      { channel: 'tail5.rotation.z', keys: [[0, 0], [0.8, 0.5], [1.6, -0.3], [2.4, 0.42], [3.5, 0]] },
      { channel: 'earL.rotation.x', keys: [[0, 0], [0.4, -0.3], [2.0, 0], [3.5, 0]] },
      { channel: 'earR.rotation.x', keys: [[0, 0], [0.45, -0.3], [2.05, 0], [3.5, 0]] },
    ],
  },
  {
    id: 'wb-review', name: '审阅代码', category: '特效',
    description: '歪头、侧看、慢眨一眼 —— 在等你确认',
    duration: 2.6, priority: 65, expression: '待你确认',
    tracks: [
      { channel: 'head.rotation.z', keys: [[0, 0], [0.7, 0.3], [1.6, 0.3], [2.6, 0]] },
      { channel: 'head.rotation.y', keys: [[0, 0], [0.9, -0.35], [1.8, -0.35], [2.6, 0]] },
      { channel: 'face.blink', keys: [[0, 0], [1.9, 0], [2.05, 1], [2.25, 0], [2.6, 0]] },
      { channel: 'earL.rotation.x', keys: [[0, 0], [0.5, -0.2], [2.6, 0]] },
      { channel: 'earR.rotation.x', keys: [[0, 0], [0.55, -0.2], [2.6, 0]] },
    ],
  },
  {
    id: 'wb-suspend', name: '挂起', category: '特效',
    description: '蜷起来闭眼等 —— 任务在跑，它陪着等',
    duration: 4.5, priority: 60, expression: '排队中',
    tracks: [
      { channel: 'pose.curl', keys: [[0, 0], [1.2, 0.8], [3.3, 0.8], [4.5, 0]] },
      { channel: 'head.rotation.x', keys: [[0, 0], [1.4, 0.25], [3.3, 0.25], [4.5, 0]] },
      { channel: 'tail5.rotation.z', keys: [[0, 0], [1.6, 0.45], [3.3, 0.45], [4.5, 0]] },
      { channel: 'face.blink', keys: [[0, 0], [1.0, 0], [1.5, 1], [3.6, 1], [4.2, 0], [4.5, 0]] },
    ],
  },
  {
    id: 'wb-wave-flag', name: '摇旗', category: '特效',
    description: '尾巴快速左右摆 —— 小赢一下',
    duration: 2.0, priority: 55, expression: '绿灯',
    tracks: [
      { channel: 'tail3.rotation.z', keys: [[0, 0], [0.4, 0.5], [0.8, -0.5], [1.2, 0.5], [1.6, -0.35], [2.0, 0]] },
      { channel: 'tail5.rotation.z', keys: [[0, 0], [0.5, 0.55], [0.9, -0.55], [1.3, 0.5], [1.7, -0.3], [2.0, 0]] },
      { channel: 'head.rotation.y', keys: [[0, 0], [0.6, 0.2], [1.2, -0.2], [2.0, 0]] },
    ],
  },
];

const actions = {
  ...builtInActions,
  actions: [...builtInActions.actions, ...wbActions],
};
fs.writeFileSync(path.join(OUT, 'actions.json'), JSON.stringify(actions, null, 2) + '\n');

// ---------------------------------------------------------------- 皮肤
// 皮肤是「合并到内置之上」，所以这份文件只写新增的那一款，不复制内置的 9 款。
//
// 但**必须先读现有的 skins.json，再增量写**。这个文件里已经有用户自己的皮肤
// （deepseek-whale 甚至是此刻生效的那一款），而 skins.json 的合并语义是
// "整份自定义集合盖住自定义集合" —— 一份不带它们的文件会把它们从盘上抹掉，
// settings.json 里 skin 指向的 id 当场变成悬空。这是这套机制里最容易造成
// 不可逆损失的一个入口，所以这里先读后写，并且先备份。
const skinsPath = path.join(OUT, 'skins.json');
const backupDir = path.join(process.env.HOME, '.lingxi', 'backup');
let existingSkins = [];
if (fs.existsSync(skinsPath)) {
  const raw = JSON.parse(fs.readFileSync(skinsPath, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`${skinsPath} 不是一个数组，停下来人工看一眼`);
  existingSkins = raw;
  // 只留第一份：它是 pre-WorkBuddy 的原样快照，是唯一的退路。
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshot = path.join(backupDir, `skins.json.pre-workbuddy-${stamp}`);
  if (!fs.readdirSync(backupDir).some((n) => n.startsWith('skins.json.pre-workbuddy-'))) {
    fs.copyFileSync(skinsPath, snapshot);
    console.log('已备份 skins.json →', snapshot);
  } else {
    console.log('已有 skins.json 快照，不覆盖（保留最早那份）');
  }
}

// WorkBuddy 品牌薄荷：`fur` 直接用应用图标的主色 #0AC89F，身体是最大的一块面积 ——
// "这是 WorkBuddy 的猫"必须一眼看得出来，所以品牌色不是点缀，是底色。
// 其余角色分工和内置的「芝麻夜航」（tuxedo）完全一致：
//   pattern → 耳朵 / 眉 / 尾端的深色区分   cream → 胸口围嘴 + 肚皮
//   paw → 白袜子                          iris → 蜜金瞳（和青绿互补，眼睛才"活"）
const wbSkin = {
  schemaVersion: 1,
  id: 'workbuddy-mint',
  name: '薄荷值班',
  description: '品牌薄荷青 · 云白围嘴 · 蜜金瞳',
  rigId: 'lingxi-cat-v1',
  pattern: 'tuxedo',
  materials: {
    fur: '#0AC89F',        // 品牌主色，取色自应用图标
    pattern: '#06806A',    // 深薄荷：耳朵、眉、尾端的暗部
    cream: '#EDFBF6',      // 围嘴与肚皮：品牌浅色 #E5F9F4 提亮一档
    iris: '#F2CD7A',       // 蜜金瞳
    pupil: '#0A3A31',
    nose: '#F0939C',
    paw: '#EDFBF6',
    mouth: '#2F6F60',
    whisker: '#EDFBF6',
    tongue: '#E998A6',
  },
};
// 同 id 覆盖、其余原样保留 —— 重跑这个脚本必须是幂等的。
const skins = [...existingSkins.filter((s) => s.id !== wbSkin.id), wbSkin];
fs.writeFileSync(skinsPath, JSON.stringify(skins, null, 2) + '\n');
const keptSkins = skins.filter((s) => s.id !== wbSkin.id).map((s) => s.id);

// ---------------------------------------------------------------- 气泡
const bubble = {
  background: '#0B2B26',
  text: '#E8FAF5',
  border: B.mint,
  borderWidth: 3,
  radius: 18,
  fontSize: 16,
  fontWeight: 500,
  shape: 'round',
  shadow: true,
};
fs.writeFileSync(path.join(OUT, 'bubble.json'), JSON.stringify(bubble, null, 2) + '\n');

// ---------------------------------------------------------------- 任务 → 反应
// 为什么这个文件非有不可：上面那份 expressions.json 定义了 WorkBuddy 的词汇
// （绿灯 / 红灯 / 上线 / 构建中 / 待你确认…），但**没有 reactions.json 时它们一个都不会被用到** ——
// 猫走的是内置映射，显示的是内置表情。词汇和映射是两件事，这是把它们接上的那一环。
//
// 只覆盖「具体到 kind」的键。内置映射里有 5 条是按 mood 细分的（上线时紧张该被安抚、
// 全绿时疲惫该被劝去休息），而自定义映射的查找顺序是
// state:kind:mood → state:mood → state:kind → state → mood → 内置，
// 意味着一条 state:kind 会盖掉同一条内置的 state:kind:mood。所以那 5 条必须原样钉在
// 最具体的那一层 —— 否则这次「品牌化」会顺手删掉猫对情绪的回应，而那恰恰是整个设计里
// 最值钱的部分：猫不镜像你的情绪，它回应你的情绪。
const pinned = {
  'completed:deploy:anxious': { expression: '放松', action: 'purr-settle', say: '上线了，没事的～' },
  'completed:deploy:proud': { expression: '得意', action: 'stretch-front', say: '上线啦！' },
  'completed:test:weary': { expression: '满足', action: 'purr-settle', say: '全绿了，可以歇啦' },
  'failed:test:frustrated': { expression: '委屈', action: 'paw-reach', say: '又红了…先喝口水？' },
  'failed:deploy:anxious': { expression: '安心', action: 'notice-you', say: '回滚就好，我看着呢' },
};

// WorkBuddy 自己的词汇。动作与表情成对使用（wb-deploy 本身就带「上线」、
// wb-wave-flag 带「绿灯」），所以这里不另选动作。
//
// running 不带 say：一次长任务会反复上报，给它配台词就是把陪伴变成播报 ——
// 应用侧的 should_react 也会把 running 的重复上报吞掉，这里配合那个设计。
const reactions = {
  ...pinned,
  'queued': { expression: '排队中', action: 'wb-suspend' },
  'running:build': { expression: '构建中' },
  'running:test': { expression: '构建中' },
  'blocked': { expression: '超时', action: 'wb-suspend', say: '卡住了…' },
  'needs_input': { expression: '待你确认', action: 'wb-review', say: '在等你点头哦' },
  'completed:test': { expression: '绿灯', action: 'wb-wave-flag', say: '测试全绿～' },
  'completed:deploy': { expression: '上线', action: 'wb-deploy', say: '上线啦！' },
  'completed:chat': { expression: '收工', action: 'wb-wave-flag', say: '这轮完了，我歇会儿～' },
  'failed:test': { expression: '红灯', action: 'shake-head', say: '有测试挂了' },
  'failed:deploy': { expression: '红灯', action: 'shake-head', say: '部署没过，我看着呢' },
};
fs.writeFileSync(path.join(OUT, 'reactions.json'), JSON.stringify(reactions, null, 2) + '\n');

console.log('写入目录:', OUT);
console.log('  动作  :', builtInActionCount, '内置 +', wbActions.length, '新增 =', actions.actions.length);
console.log('  表情  :', builtInCount, '内置 +', Object.keys(wbExpressions).length, '新增 =', Object.keys(expressions).length);
console.log('  皮肤  :', `workbuddy-mint「薄荷值班」写入/覆盖；原有 ${keptSkins.length} 款原样保留`,
  keptSkins.length ? `(${keptSkins.join(', ')})` : '');
console.log('  气泡  :', Object.keys(bubble).length, '个字段');
console.log('  反应  :', Object.keys(reactions).length, '条（含', Object.keys(pinned).length, '条钉住的内置情绪响应）');
