// 用应用自己的校验逻辑预检自定义资源，避免「点了重新加载才发现文件是错的」。
import fs from 'node:fs';
import path from 'node:path';
import { parseMotions } from '../../apps/lingxi/src/anim/motion.ts';

const REPO = '/Users/dushaobin/workspace/dsh-lingxi';
const OUT = path.join(process.env.HOME, 'Library/Application Support/com.dushaobin.lingxi-desktop/assets');

const skeleton = JSON.parse(fs.readFileSync(path.join(REPO, 'apps/lingxi/src/data/skeleton.json'), 'utf8'));
const nodeIds = skeleton.nodes.map((n) => n.id);
const POSES = ['sit', 'crouch', 'loaf', 'tuck', 'stretch', 'curl'];

// art.ts 里的图层可选值（与 LAYER_NAMES 一致）
const layers = {
  eye: ['slit', 'round', 'wide', 'side', 'half', 'happy', 'closed', 'heart', 'soft', 'wink-left', 'wink-right', 'sparkle', 'tearful'],
  brow: ['flat', 'none', 'furrow', 'raise', 'sad'],
  mouth: ['flat', 'cat', 'open', 'frown', 'hiss', 'tongue'],
  ear: ['neutral', 'forward', 'airplane', 'back'],
  symbol: ['none', 'sweat', 'question', 'exclaim', 'heart', 'sleep', 'anger'],
};
const REQUIRED_MATERIALS = ['fur', 'pattern', 'cream', 'iris', 'pupil', 'nose', 'paw', 'mouth', 'whisker', 'tongue'];

let fail = 0;
const ok = (s) => console.log('  ✅ ' + s);
const bad = (s) => { console.log('  ❌ ' + s); fail++; };

console.log('=== expressions.json（复刻 parseExpressions 规则）===');
const exps = JSON.parse(fs.readFileSync(path.join(OUT, 'expressions.json'), 'utf8'));
{
  const entries = Object.entries(exps);
  if (!entries.length || entries.length > 200) bad(`表情数量 ${entries.length} 超出 1–200`);
  else ok(`表情数量 ${entries.length} 在 1–200 内`);
  let layerErr = 0, nameErr = 0;
  for (const [name, face] of entries) {
    if (!name.trim() || name.length > 24) { bad(`表情名不合法：${name}`); nameErr++; }
    for (const layer of Object.keys(layers)) {
      if (!layers[layer].includes(face[layer])) { bad(`${name}.${layer} = ${face[layer]} 不在允许值内`); layerErr++; }
    }
  }
  if (!layerErr && !nameErr) ok(`全部 ${entries.length} 个表情的五层取值都合法，名字长度都 ≤24`);
  const newOnes = entries.map(([n]) => n).filter((n) => !['安然','好奇','满足','警觉','不爽','惊吓','困困','玩心','生气','撒娇','闭眼休息','开心','放松','认真','陶醉','期待','喵喵','清醒','安心','温柔','委屈','害羞','求抱抱','困惑','警惕','嫌弃','得意','左眼眨','右眼眨','闪亮'].includes(n));
  console.log('     新增表情:', newOnes.join(' '));
}

console.log('\n=== actions.json（调用应用真实的 parseMotions）===');
const actionsRaw = JSON.parse(fs.readFileSync(path.join(OUT, 'actions.json'), 'utf8'));
let motions = null;
try {
  motions = parseMotions(actionsRaw, nodeIds, Object.keys(exps), POSES);
  ok(`parseMotions 通过：${motions.length} 个动作全部合法`);
} catch (e) {
  bad('parseMotions 失败：' + e.message);
}
if (motions) {
  const ids = motions.map((x) => x.id);
  const dupe = ids.filter((x, i) => ids.indexOf(x) !== i);
  dupe.length ? bad('id 重复：' + dupe.join(',')) : ok('id 无重复');
  const cats = {};
  for (const x of motions) cats[x.category ?? '(无)'] = (cats[x.category ?? '(无)'] ?? 0) + 1;
  console.log('     分类分布:', JSON.stringify(cats));
  const missing = motions.filter((x) => !Object.keys(exps).includes(x.expression));
  missing.length ? bad('引用了不存在的表情：' + missing.map((x) => x.id + '->' + x.expression).join(',')) : ok('每个动作引用的表情都存在');
  console.log('     新增动作:', motions.filter((x) => x.id.startsWith('wb-')).map((x) => `${x.id}(${x.name} ${x.duration}s)`).join('  '));
}

console.log('\n=== skins.json（复刻 parseSkins 规则）===');
const skins = JSON.parse(fs.readFileSync(path.join(OUT, 'skins.json'), 'utf8'));
{
  if (!Array.isArray(skins)) bad('不是数组');
  else if (skins.length < 1 || skins.length > 60) bad(`数量 ${skins.length} 超出 1–60`);
  else ok(`数量 ${skins.length} 合法`);
  for (const [i, s] of skins.entries()) {
    if (!/^[-a-z0-9]{1,40}$/.test(s.id)) bad(`第 ${i + 1} 款 id 不合法：${s.id}`); else ok(`id "${s.id}" 符合 ^[-a-z0-9]{1,40}$`);
    if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 24) bad(`name 不合法：${s.name}`); else ok(`name "${s.name}" 长度 ${s.name.length} ≤24`);
    if (s.rigId !== undefined && s.rigId !== skeleton.id) bad(`rigId 必须是 ${skeleton.id}，实际 ${s.rigId}`); else ok(`rigId 匹配 ${skeleton.id}`);
    const miss = REQUIRED_MATERIALS.filter((k) => !/^#[0-9a-fA-F]{6}$/.test(String(s.materials?.[k] ?? '')));
    miss.length ? bad('缺少或格式错误的颜色：' + miss.join(',')) : ok(`10 项 materials 全部为 #RRGGBB`);
    for (const k of REQUIRED_MATERIALS) console.log(`     ${k.padEnd(8)} ${s.materials[k]}`);
  }
}

console.log('\n=== bubble.json（复刻 parseBubbleStyle 规则）===');
const bubble = JSON.parse(fs.readFileSync(path.join(OUT, 'bubble.json'), 'utf8'));
{
  const num = { borderWidth: [0, 12], radius: [0, 60], fontSize: [9, 48], fontWeight: [100, 900] };
  for (const [k, [lo, hi]] of Object.entries(num)) {
    if (bubble[k] === undefined) continue;
    const n = Number(bubble[k]);
    Number.isFinite(n) && n >= lo && n <= hi ? ok(`${k}=${n} 在 ${lo}–${hi}`) : bad(`${k}=${bubble[k]} 超出 ${lo}–${hi}`);
  }
  for (const k of ['background', 'text', 'border']) {
    typeof bubble[k] === 'string' && bubble[k].trim() ? ok(`${k}="${bubble[k]}"`) : bad(`${k} 不是合法颜色字符串`);
  }
  ['round', 'rect', 'cloud', 'spiky'].includes(bubble.shape) ? ok(`shape="${bubble.shape}"`) : bad('shape 不合法');
  typeof bubble.shadow === 'boolean' ? ok(`shadow=${bubble.shadow}`) : bad('shadow 必须是布尔');
}

console.log('\n' + (fail === 0 ? '✅ 全部通过 —— 可以安全地重新加载' : `❌ 有 ${fail} 处不合法`));
process.exit(fail === 0 ? 0 : 1);
