/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP=`file://${REPO_DIR}/index.html`, errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1500,height:1000} });
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await pg.goto(APP); await pg.waitForTimeout(500);

  console.log('--- the reported bug ---');
  await t('fresh seed shows the day', async () => {
    const n = await pg.$$eval('.stop .stop-acts', e=>e.length);
    if (n !== 6) throw new Error('stops='+n);
  });
  await t('a sample seeded 34 days ago re-anchors itself on open', async () => {
    await pg.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('pcp.dispatch.v1'));
      const back = s => { const x = new Date(s+'T12:00'); x.setDate(x.getDate()-34); return x.toISOString().slice(0,10); };
      d.jobs.forEach(j => { if (j.scheduledDate) j.scheduledDate = back(j.scheduledDate); });
      d.seededOn = back(d.seededOn);
      localStorage.setItem('pcp.dispatch.v1', JSON.stringify(d));
    });
    await pg.reload(); await pg.waitForTimeout(500);
    const n = await pg.$$eval('.stop .stop-acts', e=>e.length);
    if (n !== 6) throw new Error('stops after re-anchor='+n);
    if (await pg.$('[data-action="resync-demo"]')) throw new Error('banner shown when it fixed itself');
    console.log('       6 stops back, silently');
  });
  await t('relative shape is preserved, not flattened onto today', async () => {
    const spread = await pg.evaluate(() => {
      const t = todayStr();
      const j = Store.data.jobs.map(x => x.scheduledDate).filter(Boolean);
      return { past: j.filter(d=>d<t).length, today: j.filter(d=>d===t).length, future: j.filter(d=>d>t).length };
    });
    if (!spread.past || !spread.future || spread.today !== 6) throw new Error(JSON.stringify(spread));
    console.log('       ' + spread.past + ' before, ' + spread.today + ' today, ' + spread.future + ' ahead');
  });
  await t('timestamps moved with the dates', async () => {
    const ok = await pg.evaluate(() => {
      const j = Store.data.jobs.find(x => x.completedAt);
      return j ? (Date.now() - j.completedAt) < 10*86400000 : true;
    });
    if (!ok) throw new Error('completedAt left in the past');
  });

  console.log('--- older data with no date of its own ---');
  await t('offers the fix instead of moving things silently', async () => {
    await pg.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('pcp.dispatch.v1'));
      const back = s => { const x = new Date(s+'T12:00'); x.setDate(x.getDate()-34); return x.toISOString().slice(0,10); };
      d.jobs.forEach(j => { if (j.scheduledDate) j.scheduledDate = back(j.scheduledDate); });
      delete d.seededOn; delete d.demo;             // what his desktop actually has
      localStorage.setItem('pcp.dispatch.v1', JSON.stringify(d));
    });
    await pg.reload(); await pg.waitForTimeout(500);
    if (await pg.$$eval('.stop .stop-acts', e=>e.length) !== 0) throw new Error('should still be empty');
    if (!await pg.$('[data-action="resync-demo"]')) throw new Error('no banner offered');
    const txt = await pg.textContent('.legal-note');
    if (!/sample day is dated/.test(txt)) throw new Error('banner text: '+txt.slice(0,80));
    console.log('       "' + txt.replace(/\s+/g,' ').trim().slice(0,72) + '..."');
  });
  await t('the dashboard explains it too', async () => {
    await pg.click('[data-nav="dashboard"]'); await pg.waitForTimeout(350);
    if (!await pg.$('[data-action="resync-demo"]')) throw new Error('no dashboard notice');
  });
  await t('one click brings it forward and the banner goes', async () => {
    await pg.click('[data-action="resync-demo"]'); await pg.waitForTimeout(450);
    await pg.click('[data-nav="today"]'); await pg.waitForTimeout(350);
    const n = await pg.$$eval('.stop .stop-acts', e=>e.length);
    if (n !== 6) throw new Error('stops='+n);
    if (await pg.$('[data-action="resync-demo"]')) throw new Error('banner still showing');
  });
  await t('and it stays fixed after a reload', async () => {
    await pg.reload(); await pg.waitForTimeout(500);
    if (await pg.$$eval('.stop .stop-acts', e=>e.length) !== 6) throw new Error('lost on reload');
  });

  console.log('--- a live shop is never touched ---');
  await t('real jobs are left exactly where they were put', async () => {
    const before = await pg.evaluate(() => {
      Store.goLive({ company:'Poseidon Plumbing & Gasfitting Ltd.', phone:'(780) 555-0100',
                     laborRate:155, startJobNo:1200, techName:'Allen Daryl' });
      const j = { id: uid('job'), no: Store.nextJobNo(), createdAt: Date.now(),
                  customerId: null, type:'Furnace', priority:'Normal', description:'real work',
                  scheduledDate: addDays(todayStr(), -20), window:'8:00–10:00', techId:null,
                  status:'complete', completedAt: Date.now(), laborHours:1, laborRate:155,
                  parts:[], payment: blankPayment(), log:[] };
      Store.data.jobs.push(j); Store.save();
      return j.scheduledDate;
    });
    await pg.reload(); await pg.waitForTimeout(500);
    const after = await pg.evaluate(() => Store.data.jobs[0].scheduledDate);
    if (after !== before) throw new Error(`real job moved: ${before} -> ${after}`);
    if (await pg.$('[data-action="resync-demo"]')) throw new Error('offered to shift a live shop');
    console.log('       job dated ' + after + ', untouched');
  });

  await b.close();
  const hard = errs.filter(e=>e.includes('CONSOLE')||e.includes('PAGEERROR'));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
