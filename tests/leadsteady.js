/* Leads that come and go. They are read from Victor's table, not from the
   shop row, so nothing the shop does should ever take them off the screen. */
const { chromium } = require(process.env.PW || 'playwright-core');
const APP='http://127.0.0.1:54321/index.html', URL_='http://127.0.0.1:54321', KEY='sb_publishable_test';
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  await fetch(URL_+'/__reset');
  const pg = await b.newPage({ viewport:{width:430,height:900} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text())});
  await pg.goto(APP); await pg.waitForTimeout(400);
  const text = () => pg.evaluate(() => document.body.textContent.replace(/\s+/g,' '));
  // the Leads headline itself, not any other view that happens to be in the DOM
  const head = () => pg.evaluate(() => {
    const el = document.querySelector('.today-head .big');
    return el ? el.textContent.replace(/\s+/g,' ').trim() : '(no header)';
  });
  const checking = () => pg.evaluate(() =>
    [...document.querySelectorAll('.today-empty')].some(d => /Checking the website/.test(d.textContent)));

  await t('before the first read comes back it says it is looking, not "Nothing waiting"', async () => {
    await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'T'}; Cloud.saveCfg();
      Cloud.inqLoaded = false; Cloud.inquiries = []; Cloud.cfg.refreshToken = 'pending';
      App.view = "leads"; render(); }, [URL_,KEY]);
    await pg.waitForTimeout(350);
    const h = await head();
    if (/Nothing waiting/.test(h)) throw new Error('headline claims there are none before it has looked: ' + h);
    if (!/Looking/.test(h)) throw new Error('headline is: ' + h);
    if (!await checking()) throw new Error('no "checking the website" panel');
  });

  await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'T'}; Cloud.saveCfg();
    return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY]);
  await pg.waitForTimeout(1200);

  await t('once it has looked and found none, it says so plainly', async () => {
    await pg.evaluate(() => { go("leads"); render(); }); await pg.waitForTimeout(300);
    const loaded = await pg.evaluate(() => Cloud.inqLoaded);
    if (!loaded) throw new Error('never finished looking');
    if (await checking()) throw new Error('still showing the checking panel after it finished');
    const h = await head();
    if (/Looking/.test(h)) throw new Error('headline still says: ' + h);
  });

  await t('a shop conflict does not take the website leads down with it', async () => {
    // force the shop row to move under us, which is what a conflict is
    await fetch(URL_+'/__poison').catch(()=>{});
    const r = await pg.evaluate(async () => {
      Cloud.inqLoaded = false; Cloud.inquiries = [];
      Store.data.settings.company = "Edited Here"; Cloud.markDirty();
      try { await Cloud.syncNow(); } catch(e){}
      await new Promise(r => setTimeout(r, 700));
      const out = { loaded: Cloud.inqLoaded, state: Cloud.state };
      Cloud.conflictOpen = false; closeModal();
      return out;
    });
    if (!r.loaded) throw new Error('leads never loaded after a shop sync of state "' + r.state + '"');
  });

  await t('a failed shop sync does not either', async () => {
    // a clean page, so this measures the shop failing and nothing else
    await pg.reload(); await pg.waitForTimeout(600);
    await pg.evaluate(() => Cloud.boot && Cloud.boot());
    await pg.waitForTimeout(900);
    // the earlier test poisoned the shop row, so boot legitimately conflicts;
    // settle it so this test measures a failing shop and nothing else
    await pg.evaluate(async () => {
      if (Cloud.conflictOpen) await resolveConflict('mine');
    });
    await pg.waitForTimeout(900);
    const r = await pg.evaluate(async () => {
      clearTimeout(Cloud.pushTimer); Cloud.pushTimer = null;
      Cloud.inqLoaded = false; Cloud.inquiries = [];
      const realPush = Cloud.push, realPull = Cloud.pull;
      Cloud.push = Cloud.pull = async () => { throw new Error('shop is having a bad day'); };
      try { await Cloud.syncNow(); } catch(e){}
      await new Promise(r => setTimeout(r, 700));
      Cloud.push = realPush; Cloud.pull = realPull;
      return { loaded: Cloud.inqLoaded, state: Cloud.state, open: Cloud.conflictOpen };
    });
    if (!r.loaded) throw new Error('the leads went down with the shop (state "' + r.state
      + '", conflictOpen=' + r.open + ')');
    if (r.state !== 'error') throw new Error('expected the shop to report an error, got "' + r.state + '"');
  });

  await t('a lead arriving repaints the screen without him touching anything', async () => {
    await pg.evaluate(() => { Cloud.inquiries = []; Cloud.inqLoaded = true; go("leads"); });
    await pg.waitForTimeout(350);
    const seeded = await pg.evaluate(async () => {
      await fetch(Cloud.base() + '/__inq', { method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ rows: [{ id:'inq-new-1', name:'Walk In Late',
          contact:'780-555-7788', service:'drains', description:'Backing up' }] }) });
      // what the 45-second watcher does
      await Cloud.pullInquiries();
      await new Promise(r => setTimeout(r, 400));
      return document.body.textContent.includes('Walk In Late');
    });
    if (!seeded) throw new Error('the new lead never reached the screen');
  });

  await t('opening Leads goes and asks, rather than trusting what is cached', async () => {
    const asked = await pg.evaluate(async () => {
      let calls = 0;
      const real = Cloud.pullInquiries;
      Cloud.pullInquiries = function(){ calls++; return real.apply(this, arguments); };
      go("today"); await new Promise(r => setTimeout(r, 150));
      go("leads"); await new Promise(r => setTimeout(r, 300));
      Cloud.pullInquiries = real;
      return calls;
    });
    if (!asked) throw new Error('opening Leads did not re-read the table');
  });

  await t('the watcher only runs while that screen is the one he is on', async () => {
    const r = await pg.evaluate(() => {
      Cloud.watchInquiries();
      return { armed: !!Cloud._inqTimer };
    });
    if (!r.armed) throw new Error('no inquiry watcher armed');
  });

  await t('a lead he took down by hand is never at the mercy of the server', async () => {
    await pg.evaluate(() => {
      Store.addManualLead({ name:"Phoned In", phone:"780-555-2222", service:"Backflow",
        what:"Called while I was under a sink.", timing:"this week" });
      go("leads");
    });
    await pg.waitForTimeout(350);
    if (!/Phoned In/.test(await text())) throw new Error('not on the screen');
    // now break the server entirely and re-render
    const still = await pg.evaluate(async () => {
      Cloud.inquiries = []; Cloud.inqError = "no-table"; Cloud.inqLoaded = true;
      render(); await new Promise(r => setTimeout(r, 200));
      return document.body.textContent.includes("Phoned In");
    });
    if (!still) throw new Error('his own lead vanished when the website table broke');
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
