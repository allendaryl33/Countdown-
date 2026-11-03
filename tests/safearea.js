/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:390,height:844} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(400);

  // env(safe-area-inset-*) can't be set in headless, so stand in for a 34px
  // home indicator by padding the nav the same way the inset would.
  const fakeInset = px => pg.addStyleTag({ content:
    `#mobile-nav{padding-bottom:calc(6px + ${px}px)!important}
     main.content{padding-bottom:calc(92px + ${px}px)!important}` });

  const lastRowClear = () => pg.evaluate(() => {
    document.scrollingElement.scrollTo(0, 99999);
    const rows = [...document.querySelectorAll('tbody tr')];
    const last = rows[rows.length-1].getBoundingClientRect();
    const nav = document.getElementById('mobile-nav').getBoundingClientRect();
    return { gap: Math.round(nav.top - last.bottom), text: rows[rows.length-1].textContent.trim().slice(0,22),
             navH: Math.round(nav.height) };
  });

  await pg.evaluate(() => go('pricebook')); await pg.waitForTimeout(350);

  await t('on a phone with no home indicator the last row clears the nav', async () => {
    const r = await lastRowClear();
    if (r.gap < 0) throw new Error(`"${r.text}" is ${-r.gap}px under a ${r.navH}px nav`);
    console.log('       ' + r.gap + 'px of clearance under a ' + r.navH + 'px nav');
  });

  await t('and still clears it on a phone with a 34px home indicator', async () => {
    await fakeInset(34); await pg.waitForTimeout(250);
    const r = await lastRowClear();
    if (r.gap < 0) throw new Error(`"${r.text}" is ${-r.gap}px under a ${r.navH}px nav`);
    console.log('       ' + r.gap + 'px of clearance under a ' + r.navH + 'px nav');
  });

  await t('the reserved space is written in terms of the inset, not a guess', async () => {
    const css = await pg.evaluate(() => [...document.styleSheets]
      .flatMap(s => { try { return [...s.cssRules].map(r=>r.cssText); } catch(e){ return []; } })
      .filter(r => r.includes('main.content') && r.includes('padding')).join(' | '));
    if (!/safe-area-inset-bottom/.test(css)) throw new Error('flat padding: '+css);
    console.log('       ' + css.slice(0,90));
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
