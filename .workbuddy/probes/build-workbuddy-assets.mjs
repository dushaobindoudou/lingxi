// 生成 WorkBuddy 主题的自定义资源包。
// 动作库 / 表情集是「整体替换」，所以必须先把内置的完整带上，再追加新的。
import fs from 'node:fs';
import path from 'node:path';

const REPO = '/Users/dushaobin/workspace/dsh-lingxi';
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
// 只写新增的一款 —— 自定义皮肤是「合并到内置之上」，不需要复制那 9 款。
const skins = [
  {
    schemaVersion: 1,
    id: 'workbuddy-mint',
    name: '青釉工蜂',
    description: 'WorkBuddy 品牌青绿 · 取色自应用图标 #0AC89F · 奶白围嘴',
    rigId: 'lingxi-cat-v1',
    pattern: 'tuxedo',
    materials: {
      fur: B.mintSoft,        // 主体：品牌色的中间调，柔和到仍然像猫毛
      pattern: B.mintDeep,    // 深青绿，用于虎斑式暗纹
      cream: B.mintPale,      // 围嘴 / 白袜：品牌浅色
      iris: B.gold,           // 暖金瞳 —— 和青绿形成补色，眼睛才"活"
      pupil: B.ink,
      nose: B.rose,
      paw: B.mintPale,
      mouth: B.plum,
      whisker: B.mintPale,
      tongue: '#E998A6',
    },
  },
];
fs.writeFileSync(path.join(OUT, 'skins.json'), JSON.stringify(skins, null, 2) + '\n');

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

console.log('写入目录:', OUT);
console.log('  动作  :', builtInActionCount, '内置 +', wbActions.length, '新增 =', actions.actions.length);
console.log('  表情  :', builtInCount, '内置 +', Object.keys(wbExpressions).length, '新增 =', Object.keys(expressions).length);
console.log('  皮肤  :', skins.length, '款新增（合并到内置 9 款之上）');
console.log('  气泡  :', Object.keys(bubble).length, '个字段');
