const { chromium } = require(process.env.PW || 'playwright-core');
const URL_='http://127.0.0.1:54321', KEY='sb_publishable_test', errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:430,height:930} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{const x=m.text(); if(m.type()==='error' && !/ERR_INTERNET_DISCONNECTED/.test(x)) errs.push('CONSOLE: '+x)});
  await fetch(URL_+'/__reset');
  await pg.goto(URL_+'/index.html'); await pg.waitForTimeout(450);

  console.log('--- iOS throwing the app out mid-photo ---');
  await t('a reload puts you back in the job you had open', async () => {
    const jid = await pg.evaluate(() => { const j = Store.data.jobs.find(x=>isOpen(x)); openJob(j.id); return j.id; });
    await pg.waitForTimeout(400);
    await pg.reload(); await pg.waitForTimeout(900);
    const r = await pg.evaluate(() => ({
      modal: !!document.querySelector('.modal'),
      title: (document.querySelector('.modal-head h2')||{}).textContent || '' }));
    if (!r.modal) throw new Error('landed with nothing open');
    console.log('       reopened "' + r.title.trim() + '"');
  });

  await t('and back on the view you were on, not Today', async () => {
    await pg.evaluate(() => { closeModal(); go('timemoney'); }); await pg.waitForTimeout(400);
    await pg.reload(); await pg.waitForTimeout(900);
    const v = await pg.evaluate(() => App.view);
    if (v !== 'timemoney') throw new Error('landed on ' + v);
  });

  await t('an estimate comes back too', async () => {
    const eid = await pg.evaluate(() => { const e = Store.data.estimates[0]; openEstimate(e.id); return e.id; });
    await pg.waitForTimeout(400);
    await pg.reload(); await pg.waitForTimeout(900);
    const open = await pg.evaluate(() => {
      const h = document.querySelector('.modal-head h2');
      return h ? h.textContent : null; });
    if (!open) throw new Error('estimate not reopened');
  });

  await t('closing a record means it does not come back', async () => {
    await pg.evaluate(() => closeModal()); await pg.waitForTimeout(300);
    await pg.reload(); await pg.waitForTimeout(900);
    const m = await pg.evaluate(() => !!document.querySelector('.modal'));
    if (m) throw new Error('reopened something that was deliberately closed');
  });

  await t('yesterday\'s place is not restored today', async () => {
    await pg.evaluate(() => {
      const j = Store.data.jobs.find(x=>isOpen(x));
      openJob(j.id);
      const p = JSON.parse(localStorage.getItem('pcp.place.v1'));
      p.at = Date.now() - 3*60*60*1000;       // three hours ago
      localStorage.setItem('pcp.place.v1', JSON.stringify(p));
    });
    await pg.reload(); await pg.waitForTimeout(900);
    const r = await pg.evaluate(() => ({ m: !!document.querySelector('.modal'), v: App.view }));
    if (r.m) throw new Error('reopened a stale record');
    if (r.v !== 'today') throw new Error('did not fall back to Today: ' + r.v);
    console.log('       falls back to Today after a few hours');
  });

  await t('a deleted record does not break the restore', async () => {
    const jid = await pg.evaluate(() => { const j = Store.data.jobs.find(x=>isOpen(x)); openJob(j.id); return j.id; });
    await pg.evaluate(id => { Store.data.jobs = Store.data.jobs.filter(j => j.id !== id); Store.save(); }, jid);
    await pg.reload(); await pg.waitForTimeout(900);
    const v = await pg.evaluate(() => App.view);
    if (!v) throw new Error('app did not boot');
    console.log('       booted cleanly with the record gone');
  });

  console.log('--- knowing what is still only on the phone ---');
  const strip = () => pg.evaluate(() => {
    if (App.view !== 'today') go('today'); else render();
    const e = document.querySelector('.waiting');
    return e ? e.textContent.replace(/\s+/g,' ').trim() : '';
  });

  await t('nothing is said when there is nothing to say', async () => {
    await pg.evaluate(([u,k]) => {
      Cloud.cfg = { url:u, key:k, email:'', deviceId:'Phone' }; Cloud.saveCfg();
      return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow());
    }, [URL_, KEY]);
    await pg.waitForTimeout(1400);
    const s = await strip();
    if (s) throw new Error('said: ' + s);
  });

  await t('an ordinary edit does not raise an alarm', async () => {
    await pg.evaluate(() => { Store.data.jobs[0].priority = 'High'; Store.save(); });
    await pg.waitForTimeout(300);
    const s = await strip();
    if (s) throw new Error('cried wolf over a normal edit: ' + s);
    console.log('       stays quiet, so it means something when it speaks');
  });

  await t('a photo taken with no signal says so, and says it is safe', async () => {
    await pg.context().setOffline(true);
    const jid = await pg.evaluate(() => { const j = Store.data.jobs.find(x=>isOpen(x)); openJob(j.id); return j.id; });
    await pg.waitForTimeout(300);
    await pg.setInputFiles('[data-ph-file]', process.env.SP + '/testphoto.jpg');
    await pg.waitForTimeout(1200);
    await pg.evaluate(() => { closeModal(); return Cloud.syncNow(); });
    await pg.waitForTimeout(900);
    const s = await strip();
    if (!/still only on this phone/.test(s)) throw new Error('said: ' + s);
    if (!/safe/i.test(s)) throw new Error('did not reassure: ' + s);
    console.log('       "' + s.slice(0, 72) + '…"');
  });

  await t('and it clears itself once the photo is up', async () => {
    await pg.context().setOffline(false);
    await pg.evaluate(() => Cloud.syncNow());
    await pg.waitForTimeout(3000);
    const s = await strip();
    if (s) throw new Error('still showing: ' + s);
    const srv = await (await fetch(URL_+'/__state')).json();
    if (!Object.keys(srv.objects).length) throw new Error('nothing actually uploaded');
    console.log('       strip gone, photo on the server');
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
