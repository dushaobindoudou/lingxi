// 手机视口校验：坏图 / 横向溢出 / 页面报错 / 图片是否真渲染出来
const { chromium } = require('playwright-core');
const fs = require('fs');

const targets = [
  ['site (多文件)', '/Users/liepin/workspace/lingxi-v5fix/reviews/b4-round/site/index.html'],
  ['offline (单文件)', '/Users/liepin/workspace/lingxi-v5fix/reviews/b4-round/lingxi-review-offline.html']
];

(async () => {
  const b = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox']
  });
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true
  });
  const out = {};
  for (const [label, file] of targets) {
    if (!fs.existsSync(file)) { out[label] = 'MISSING'; continue; }
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
    await pg.goto('file://' + file.split('/').map(encodeURIComponent).join('/'),
                  { waitUntil: 'load' });
    await pg.waitForTimeout(1200);
    // 触发 lazy load：滚到底再回顶
    await pg.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    });
    await pg.waitForTimeout(1500);
    out[label] = await pg.evaluate(() => {
      const imgs = [...document.images];
      return {
        imgTotal: imgs.length,
        broken: imgs.filter(i => !i.complete || i.naturalWidth === 0).map(i => i.src.slice(0, 60)),
        // 渲染出来有多宽：为 0 说明被 CSS 压没了
        zeroWidth: imgs.filter(i => i.getBoundingClientRect().width < 4).length,
        hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        tallest: document.body.scrollHeight
      };
    });
    out[label].errs = errs;
    await pg.close();
  }
  console.log(JSON.stringify(out, null, 2));
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
