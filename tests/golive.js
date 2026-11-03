const { chromium } = require(process.env.PW || 'playwright-core');
const URL_='http://127.0.0.1:54321', KEY='sb_publishable_test', errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1400,height:1000} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await fetch(URL_+'/__reset');
  await pg.goto(URL_+'/index.html'); await pg.waitForTimeout(450);

  const fill = () => pg.evaluate(() => {
    Object.assign(Store.data.settings, {
      phone:'(780) 414-9900', email:'admin@poseidonplumbing.ca',
      website:'poseidonplumbing.ca', address:'Edmonton, AB', gst:'123456789 RT0001'
    });
    Store.saveLocal();
  });

  await t('going live keeps the details that were typed in once already', async () => {
    await fill();
    await pg.evaluate(() => { go('data'); });
    await pg.waitForTimeout(300);
    await pg.evaluate(() => openGoLive()); await pg.waitForTimeout(350);
    await pg.fill('#gl-company', 'Poseidon Plumbing & Gasfitting Ltd.');
    await pg.fill('#gl-tech', 'Allen Daryl');
    await pg.fill('#gl-rate', '165');
    pg.once('dialog', d => d.accept());          // it asks before deleting
    await pg.click('.modal [data-do-golive]');
    await pg.waitForTimeout(900);
    const st = await pg.evaluate(() => Store.data.settings);
    const lost = ['email','website','address','gst'].filter(k => !st[k]);
    if (lost.length) throw new Error('blanked: ' + lost.join(', '));
    if (st.laborRate !== 165) throw new Error('rate not applied: ' + st.laborRate);
    console.log('       ' + st.email + ' · ' + st.website + ' · GST ' + st.gst + ' · $' + st.laborRate + '/hr');
  });

  await t('and it did actually clear the sample shop', async () => {
    const d = await pg.evaluate(() => ({
      jobs: Store.data.jobs.length, cust: Store.data.customers.length,
      book: Store.data.priceBook.length, tpl: Store.data.waiverTemplates.length,
      demo: Store.data.demo, live: !!Store.data.liveSince }));
    if (d.jobs || d.cust) throw new Error('samples survived: ' + JSON.stringify(d));
    if (!d.book || !d.tpl) throw new Error('price book or templates lost: ' + JSON.stringify(d));
    if (d.demo || !d.live) throw new Error('not marked live: ' + JSON.stringify(d));
    console.log('       0 jobs, 0 customers, ' + d.book + ' price items, ' + d.tpl + ' templates kept');
  });

  await t('a connected shop is warned that this clears the other devices', async () => {
    await pg.evaluate(() => localStorage.clear());
    await pg.reload(); await pg.waitForTimeout(500);
    await pg.evaluate(([u,k]) => {
      Cloud.cfg = { url:u, key:k, email:'', deviceId:'Mac-a' }; Cloud.saveCfg();
      return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow());
    }, [URL_, KEY]);
    await pg.waitForTimeout(900);
    await pg.evaluate(() => openGoLive()); await pg.waitForTimeout(350);
    const txt = await pg.$eval('.modal', e => e.textContent.replace(/\s+/g,' '));
    if (!/clears your other devices too/i.test(txt)) throw new Error('no sync warning shown');
    console.log('       warning shown');
    await pg.keyboard.press('Escape');
  });

  await t('and an unconnected one is not told something untrue', async () => {
    await pg.evaluate(() => { Cloud.disconnect(); render(); }); await pg.waitForTimeout(300);
    await pg.evaluate(() => openGoLive()); await pg.waitForTimeout(350);
    const txt = await pg.$eval('.modal', e => e.textContent.replace(/\s+/g,' '));
    if (/other devices too/i.test(txt)) throw new Error('warns about sync with no sync set up');
    if (!/company details/i.test(txt)) throw new Error('does not say details are kept');
    console.log('       no spurious warning');
  });

  await t('every setting he configured survives going live', async () => {
    // This has broken twice by listing fields to keep one at a time, so the
    // test names them all and will fail the day another one is forgotten.
    const before = await pg.evaluate(() => {
      Object.assign(Store.data.settings, {
        email:'admin@poseidonplumbing.ca', website:'poseidonplumbing.ca',
        address:'Edmonton, AB', gst:'123456789 RT0001', gstRate:5,
        signBase:'https://poseidonplumbing.ca/sign', signShort:true,
        payStripeUrl:'https://buy.stripe.com/abc', payEtransfer:'admin@poseidonplumbing.ca',
        payCash:true, invoiceTerms:15, invoiceTermsMode:'completion',
        invoiceNote:'Thanks very much for the work.'
      });
      Store.save();
      return JSON.parse(JSON.stringify(Store.data.settings));
    });
    await pg.evaluate(() => Store.goLive({
      company:'Poseidon Plumbing & Gasfitting Ltd.', phone:'(780) 932-6277',
      laborRate:145, startJobNo:1000, techName:'Allen'
    }));
    const after = await pg.evaluate(() => JSON.parse(JSON.stringify(Store.data.settings)));

    const mustSurvive = ['email','website','address','gst','gstRate','signBase','signShort',
      'payStripeUrl','payEtransfer','payCash','invoiceTerms','invoiceTermsMode','invoiceNote'];
    const lost = mustSurvive.filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
    if (lost.length) throw new Error('wiped: ' + lost.join(', '));

    if (after.company !== 'Poseidon Plumbing & Gasfitting Ltd.') throw new Error('company not set');
    if (after.laborRate !== 145) throw new Error('labor rate not set');
    const cleared = await pg.evaluate(() => ({ jobs: Store.data.jobs.length,
      customers: Store.data.customers.length, live: !!Store.data.liveSince,
      book: Store.data.priceBook.length, templates: Store.data.waiverTemplates.length }));
    if (cleared.jobs || cleared.customers) throw new Error('demo data left behind');
    if (!cleared.live) throw new Error('not marked live');
    if (!cleared.book || !cleared.templates) throw new Error('lost the price book or templates');
    console.log('       kept ' + mustSurvive.length + ' settings, price book and templates; cleared the demo');
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
