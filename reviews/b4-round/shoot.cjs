const { chromium } = require('playwright-core');
const p = process.argv[2] || '/Users/liepin/workspace/lingxi-v5fix/reviews/b4-round/index.html';
const url = 'file://' + p.split('/').map(encodeURIComponent).join('/');
const OUT = process.argv[3] || '/Users/liepin/workspace/lingxi-v5fix/reviews/b4-round/shots';
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox']
  });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await pg.goto(url, { waitUntil: 'load' });
  await pg.waitForTimeout(2500);

  // 溢出检查
  const hscroll = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  // 空图检查
  const broken = await pg.evaluate(() => [...document.images].filter(i => !i.complete || i.naturalWidth === 0).map(i => i.src.split('/').pop()));
  // 重复 id 检查
  const dupIds = await pg.evaluate(() => { const m = {}; document.querySelectorAll('[id]').forEach(e => m[e.id] = (m[e.id] || 0) + 1); return Object.entries(m).filter(([, v]) => v > 1).map(([k]) => k); });

  // 逐屏滚动截图
  const H = await pg.evaluate(() => document.body.scrollHeight);
  let i = 0;
  for (let y = 0; y < H - 200; y += 800) {
    await pg.evaluate(v => window.scrollTo(0, v), y);
    await pg.waitForTimeout(500);
    await pg.screenshot({ path: OUT + '/seq-' + String(i).padStart(2, '0') + '.png' });
    i++;
  }

  // 点击 pin 测试弹出
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.waitForTimeout(300);
  const pins = await pg.$$('.pin');
  let tipOk = false;
  if (pins.length) {
    await pins[0].scrollIntoViewIfNeeded();
    await pg.waitForTimeout(300);
    await pins[0].click();
    await pg.waitForTimeout(400);
    tipOk = await pg.evaluate(() => { const t = document.getElementById('tip'); return t && t.style.display === 'block' && t.innerHTML.length > 50; });
    await pg.screenshot({ path: OUT + '/tip-open.png' });
  }

  console.log(JSON.stringify({ hscroll, broken, dupIds, pinCount: pins.length, tipOk, errs }, null, 2));
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
