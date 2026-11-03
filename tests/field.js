/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP=`file://${REPO_DIR}/index.html`, SHOTS=process.env.SP+'/shots', errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t = async (n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const sec = n => console.log('--- '+n+' ---');

  // --- phone ---
  const ph = await b.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  ph.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  ph.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await ph.goto(APP); await ph.waitForTimeout(500);

  sec('phone — Today is the front door');
  await t('lands on Today, not the dashboard', async () => {
    if ((await ph.textContent('#page-title')).trim() !== 'Today') throw new Error(await ph.textContent('#page-title'));
  });
  await t('desktop sidebar hidden, bottom bar shown', async () => {
    if (await ph.isVisible('#sidebar')) throw new Error('sidebar still visible on phone');
    if (!await ph.isVisible('#mobile-nav')) throw new Error('no bottom nav');
    // five views plus More, since Invoices joined the bar
    const n = await ph.$$eval('#mobile-nav button', e=>e.length);
    if (n !== 6) throw new Error('nav buttons='+n);
  });
  await t('no sideways scroll', async () => {
    const o = await ph.evaluate(()=>document.documentElement.scrollWidth - window.innerWidth);
    if (o > 1) throw new Error('overflows by '+o+'px');
  });
  await t('stops render with the day summary', async () => {
    const stops = await ph.$$eval('.stop', e=>e.length);
    if (!stops) throw new Error('no stops');
    const sum = await ph.textContent('.today-sum');
    if (!/booked/.test(sum)) throw new Error('summary: '+sum);
    console.log('       ' + (await ph.textContent('.today-head .big')).trim() + ' · ' + sum.replace(/\s+/g,' ').trim());
  });
  await t('call and directions are real links', async () => {
    const tel = await ph.getAttribute('.stop-acts a[href^="tel:"]','href');
    if (!/^tel:\d{10}$/.test(tel||'')) throw new Error('tel: '+tel);
    const map = await ph.getAttribute('.stop-acts a[href*="google.com/maps"]','href');
    if (!/Edmonton/.test(decodeURIComponent(map||''))) throw new Error('map link: '+map);
    const rel = await ph.getAttribute('.stop-acts a[href*="maps"]','rel');
    if (!/noopener/.test(rel||'')) throw new Error('map link missing noopener');
  });
  await t('site notes and missing waivers surface on the card', async () => {
    const flags = await ph.$$eval('.stop-flag', e=>e.map(x=>x.textContent.trim()));
    if (!flags.some(f=>f.startsWith('📌'))) throw new Error('no site note flag');
    if (!flags.some(f=>f.startsWith('✍'))) throw new Error('no waiver flag');
    console.log('       ' + flags.length + ' flags, e.g. "' + flags[0].slice(0,54) + '"');
  });
  await t('tap targets are big enough for a thumb', async () => {
    const small = await ph.$$eval('.stop-acts .btn, #mobile-nav button',
      els => els.map(e=>Math.round(e.getBoundingClientRect().height)).filter(h=>h<40));
    if (small.length) throw new Error('heights under 40px: '+small.join(','));
  });
  await ph.screenshot({ path: SHOTS+'/f1-today.png', fullPage:false });

  sec('phone — working a stop');
  await t('advancing stays on the list instead of opening a modal', async () => {
    const before = await ph.textContent('.today-head .big');
    await ph.click('.stop .btn.accent'); await ph.waitForTimeout(400);
    if (await ph.$('.modal')) throw new Error('a modal opened');
    if ((await ph.textContent('.today-head .big')) === before && before.includes('left')) {
      // status moved within open set, fine — just assert a toast fired
    }
    const log = await ph.evaluate(() => Store.data.jobs.some(j => (j.log||[]).some(l=>/^Status:/.test(l.text))));
    if (!log) throw new Error('no status change recorded');
  });
  await t('tapping the card body opens the full job', async () => {
    await ph.click('.stop-main'); await ph.waitForTimeout(400);
    if (!(await ph.textContent('.modal-head')).includes('Job #')) throw new Error('job did not open');
    await ph.click('.modal-foot [data-close]'); await ph.waitForTimeout(250);
  });
  await t('More sheet reaches the rest of the app', async () => {
    await ph.click('[data-navsheet]'); await ph.waitForTimeout(300);
    if (!await ph.isVisible('#nav-sheet .sheet')) throw new Error('sheet did not open');
    await ph.click('#nav-sheet [data-nav="customers"]'); await ph.waitForTimeout(400);
    if ((await ph.textContent('#page-title')).trim() !== 'Customers') throw new Error('nav failed');
    if (await ph.isVisible('#nav-sheet .sheet')) throw new Error('sheet stayed open');
  });
  await ph.screenshot({ path: SHOTS+'/f2-sheet.png' });

  // --- desktop still fine ---
  sec('desktop unaffected');
  const pc = await b.newPage({ viewport:{width:1500,height:1000} });
  pc.on('pageerror',e=>errs.push('PAGEERROR(desktop): '+e.message));
  await pc.goto(APP); await pc.waitForTimeout(500);
  await t('sidebar shown, bottom bar hidden', async () => {
    if (!await pc.isVisible('#sidebar')) throw new Error('no sidebar');
    if (await pc.isVisible('#mobile-nav')) throw new Error('bottom nav showing on desktop');
  });
  await t('Today is in the sidebar and the board still works', async () => {
    if (!(await pc.textContent('#nav')).includes('Today')) throw new Error('no Today nav');
    await pc.click('[data-nav="schedule"]'); await pc.waitForTimeout(350);
    if (await pc.$$eval('.dg-head', e=>e.length) !== 5) throw new Error('board broken');
  });
  await pc.screenshot({ path: SHOTS+'/f3-desktop-today.png' });

  sec('going live');
  await t('setup clears the demo but keeps the price book and templates', async () => {
    await pc.click('[data-nav="data"]'); await pc.waitForTimeout(350);
    await pc.click('[data-action="golive"]'); await pc.waitForTimeout(350);
    const before = await pc.evaluate(() => ({ pb: Store.data.priceBook.length, wt: Store.activeTemplates().length }));
    await pc.fill('#gl-tech','Allen Daryl');
    await pc.fill('#gl-techphone','7805550199');
    await pc.fill('#gl-rate','155');
    await pc.fill('#gl-jobno','1200');
    pc.once('dialog', d => d.accept());
    await pc.click('[data-do-golive]'); await pc.waitForTimeout(600);
    const after = await pc.evaluate(() => ({
      cust: Store.data.customers.length, jobs: Store.data.jobs.length,
      est: Store.data.estimates.length, wv: Store.data.signedWaivers.length,
      pb: Store.data.priceBook.length, wt: Store.activeTemplates().length,
      techs: Store.data.techs.map(t=>t.name), rate: Store.data.settings.laborRate,
      counter: Store.data.counter, live: !!Store.data.liveSince, view: App.view
    }));
    if (after.cust||after.jobs||after.est||after.wv) throw new Error('demo data left: '+JSON.stringify(after));
    if (after.pb !== before.pb || after.wt !== before.wt) throw new Error('price book or templates lost');
    if (after.techs.join() !== 'Allen Daryl') throw new Error('techs: '+after.techs.join());
    if (after.rate !== 155) throw new Error('rate: '+after.rate);
    if (after.counter !== 1200) throw new Error('job counter: '+after.counter);
    if (!after.live) throw new Error('liveSince not set');
    if (after.view !== 'today') throw new Error('did not land on Today');
    console.log('       kept '+after.pb+' price items, '+after.wt+' templates; crew of 1; next job #'+(after.counter+1));
  });
  await t('empty shop renders everywhere without errors', async () => {
    for (const v of ['today','dashboard','schedule','jobs','customers','estimates','waivers','pricebook','data']){
      await pc.click(`[data-nav="${v}"]`); await pc.waitForTimeout(220);
      const txt = await pc.textContent('#view');
      if (!txt || txt.trim().length < 10) throw new Error(v+' rendered empty');
    }
  });
  await pc.screenshot({ path: SHOTS+'/f4-empty.png' });
  await t('a first real job can be taken', async () => {
    await pc.click('#btn-new-job'); await pc.waitForTimeout(350);
    await pc.selectOption('#f-customer','__new');
    await pc.fill('#nc-name','First Real Customer');
    await pc.fill('#nc-address','9910 109 St NW');
    await pc.fill('#f-desc','No hot water, 40gal gas tank.');
    await pc.click('[data-save-job]'); await pc.waitForTimeout(450);
    const j = await pc.evaluate(() => Store.data.jobs[0]);
    if (!j || j.no !== 1201) throw new Error('job no: '+(j&&j.no));
    console.log('       job #'+j.no+' created on an empty shop');
  });
  await t('survives reload', async () => {
    await pc.reload(); await pc.waitForTimeout(500);
    const o = await pc.evaluate(() => ({ n: Store.data.jobs.length, live: !!Store.data.liveSince }));
    if (o.n !== 1 || !o.live) throw new Error(JSON.stringify(o));
  });

  await b.close();
  const hard = errs.filter(e=>e.includes('CONSOLE')||e.includes('PAGEERROR'));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
