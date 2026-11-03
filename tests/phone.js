/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it if the app lives elsewhere. */
const APP = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:2 });
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await pg.goto(`file://${APP}/index.html`); await pg.waitForTimeout(450);

  const cs = (sel, prop) => pg.evaluate(([s,p]) => {
    const el = document.querySelector(s); return el ? getComputedStyle(el)[p] : null;
  }, [sel, prop]);

  await t('the phone overrides actually win now', async () => {
    const pad = await cs('main.content','paddingLeft');
    if (pad !== '13px') throw new Error('content side padding is '+pad+', desktop rule still winning');
    const h1 = await cs('.topbar h1','fontSize');
    if (h1 !== '17px') throw new Error('title '+h1);
    const crumb = await cs('.topbar .crumb','display');
    if (crumb !== 'none') throw new Error('crumb visible on a phone');
    console.log('       13px gutters, 17px title, crumb hidden');
  });
  await t('the search box spans the width instead of a fixed 250px', async () => {
    const w = await pg.evaluate(() => Math.round(document.querySelector('.search input').getBoundingClientRect().width));
    if (w < 330) throw new Error('search input is '+w+'px wide');
    console.log('       search is ' + w + 'px across');
  });
  await t('stat tiles go two-up, not auto-fit', async () => {
    await pg.evaluate(() => go('dashboard')); await pg.waitForTimeout(350);
    const cols = await cs('.stat-row','gridTemplateColumns');
    if ((cols||'').split(' ').length !== 2) throw new Error('columns: '+cols);
    console.log('       ' + cols);
  });
  await t('nothing overflows the viewport sideways on any view', async () => {
    const bad = [];
    for (const v of ['today','dashboard','schedule','estimates','jobs','timemoney','customers','waivers','techs','pricebook','setup']){
      await pg.evaluate(x => go(x), v); await pg.waitForTimeout(260);
      const over = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) bad.push(v + ' +' + over + 'px');
    }
    if (bad.length) throw new Error(bad.join(', '));
    console.log('       all 11 views fit 390px');
  });
  await t('the last row of every long view clears the bottom nav', async () => {
    const bad = [];
    for (const v of ['jobs','pricebook','customers','waivers','timemoney']){
      await pg.evaluate(x => go(x), v); await pg.waitForTimeout(260);
      const r = await pg.evaluate(() => {
        document.scrollingElement.scrollTo(0, 99999);
        const els = [...document.querySelectorAll('tbody tr, .tpl-card, .stop, .card')];
        if (!els.length) return { gap: 99 };
        const last = els[els.length-1].getBoundingClientRect();
        const nav = document.getElementById('mobile-nav').getBoundingClientRect();
        return { gap: Math.round(nav.top - last.bottom) };
      });
      if (r.gap < 0) bad.push(v + ' ' + (-r.gap) + 'px under');
    }
    if (bad.length) throw new Error(bad.join(', '));
    console.log('       jobs, price book, customers, waivers, time & money all clear');
  });
  await t('a modal fits the screen and its body scrolls', async () => {
    await pg.evaluate(() => go('jobs')); await pg.waitForTimeout(300);
    await pg.evaluate(() => openJob(Store.data.jobs[0].id)); await pg.waitForTimeout(350);
    const m = await pg.evaluate(() => {
      const mo = document.querySelector('.modal').getBoundingClientRect();
      const body = document.querySelector('.modal-body');
      return { w: Math.round(mo.width), over: Math.round(mo.right - window.innerWidth),
               scrolls: body.scrollHeight > body.clientHeight,
               bodyBottom: Math.round(body.getBoundingClientRect().bottom) };
    });
    if (m.over > 1) throw new Error('modal runs ' + m.over + 'px off screen');
    if (m.bodyBottom > 844) throw new Error('modal body runs past the screen bottom');
    console.log('       ' + m.w + 'px wide, body scrolls: ' + m.scrolls);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
  });

  for (const v of ['today','pricebook','timemoney','dashboard']){
    await pg.evaluate(x => go(x), v); await pg.waitForTimeout(300);
    await pg.screenshot({ path: process.env.SP + '/shots/ph-' + v + '.png' });
  }

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
