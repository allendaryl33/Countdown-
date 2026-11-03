/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const URL_='http://127.0.0.1:54321', KEY='sb_publishable_test', errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:390,height:844}, hasTouch:true });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  const open = async () => { await pg.click('[data-navsheet]'); await pg.waitForTimeout(260); };
  const isOpen = () => pg.evaluate(() => !document.getElementById('nav-sheet').hidden);

  console.log('--- the More sheet ---');
  await t('it opens', async () => { await open(); if (!await isOpen()) throw new Error('did not open'); });

  await t('the handle is a real control, not just a line', async () => {
    const g = await pg.evaluate(() => {
      const el = document.querySelector('.nav-sheet .grabzone');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, label: el.getAttribute('aria-label'), h: Math.round(r.height) };
    });
    if (!g) throw new Error('no grab zone');
    if (g.tag !== 'BUTTON') throw new Error('not focusable: ' + g.tag);
    if (g.h < 20) throw new Error('target only ' + g.h + 'px tall');
    console.log('       ' + g.h + 'px tall, labelled "' + g.label + '"');
  });

  await t('tapping the handle closes it', async () => {
    await pg.click('.nav-sheet .grabzone'); await pg.waitForTimeout(350);
    if (await isOpen()) throw new Error('still open');
  });

  await t('dragging the handle down closes it', async () => {
    await open();
    const box = await pg.$eval('.nav-sheet .grabzone', el => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2 };
    });
    await pg.mouse.move(box.x, box.y);
    await pg.mouse.down();
    for (let i = 1; i <= 6; i++){ await pg.mouse.move(box.x, box.y + i*22); await pg.waitForTimeout(16); }
    await pg.mouse.up();
    await pg.waitForTimeout(400);
    if (await isOpen()) throw new Error('a 130px drag did not dismiss it');
    console.log('       130px drag dismissed it');
  });

  await t('a small drag springs back instead of closing', async () => {
    await open();
    const box = await pg.$eval('.nav-sheet .grabzone', el => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2 };
    });
    await pg.mouse.move(box.x, box.y);
    await pg.mouse.down();
    await pg.mouse.move(box.x, box.y + 25); await pg.waitForTimeout(16);
    await pg.mouse.up();
    await pg.waitForTimeout(400);
    if (!await isOpen()) throw new Error('a 25px nudge closed it');
    const tr = await pg.$eval('.nav-sheet .sheet', el => el.style.transform);
    if (!/translateY\(0/.test(tr)) throw new Error('did not spring back: ' + tr);
    console.log('       sprang back to ' + tr);
  });

  await t('the page behind cannot be scrolled through the sheet', async () => {
    if (!await isOpen()) await open();
    const css = await pg.evaluate(() => {
      const o = getComputedStyle(document.querySelector('.nav-sheet.open'));
      const i = getComputedStyle(document.querySelector('.nav-sheet .sheet'));
      return { overlayTouch: o.touchAction, overlayChain: o.overscrollBehaviorY,
               sheetChain: i.overscrollBehaviorY };
    });
    if (css.overlayTouch !== 'none') throw new Error('overlay touch-action=' + css.overlayTouch);
    if (!/contain|none/.test(css.overlayChain)) throw new Error('overlay chains: ' + css.overlayChain);
    if (!/contain|none/.test(css.sheetChain)) throw new Error('sheet chains: ' + css.sheetChain);
    console.log('       overlay locked, sheet scroll contained');
  });

  await t('tapping the backdrop still closes it', async () => {
    await pg.mouse.click(195, 60); await pg.waitForTimeout(300);
    if (await isOpen()) throw new Error('backdrop tap did nothing');
  });

  await t('picking a view from it still navigates', async () => {
    await open();
    await pg.click('.nav-sheet [data-nav="timemoney"]'); await pg.waitForTimeout(400);
    const v = await pg.evaluate(() => App.view);
    if (v !== 'timemoney') throw new Error('went to ' + v);
    if (await isOpen()) throw new Error('sheet left open after navigating');
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
