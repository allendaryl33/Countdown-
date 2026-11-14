/* Two devices that both saved keep both sets of changes.

   Nov 13: the browser recorded a $2,000 part payment while the phone had
   sent that invoice and saved the e-Transfer address. The app asked which
   copy to keep, "Keep this device" was chosen, and the phone's two changes
   were gone — a sent invoice back to "not sent", the address back to empty.

   Now the two are merged against the copy both last agreed on. Whoever
   changed a field wins it; only a field both changed differently is asked
   about, by name. The scenario is replayed here with two real pages on one
   shop: A is the browser, B is the phone.                               */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP='http://127.0.0.1:54321/index.html', URL_='http://127.0.0.1:54321', KEY='sb_publishable_test';
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  await fetch(URL_+'/__reset');
  const dev = async name => {
    const ctx = await b.newContext({ viewport:{width:1280,height:1000} });   // own storage, like a real second device
    const pg = await ctx.newPage();
    pg.on('pageerror',e=>errs.push(name+' PAGEERROR: '+e.message));
    pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(name+' CONSOLE: '+m.text())});
    pg.on('download', () => {});
    await pg.goto(APP); await pg.waitForTimeout(400);
    await pg.evaluate(([u,k,n]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:n}; Cloud.saveCfg();
      return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY,name]);
    await pg.waitForTimeout(800);
    return pg;
  };
  const A = await dev('Browser');
  // A's copy goes up first so both start from the same shop
  const jid = await A.evaluate(async () => {
    clearTimeout(Cloud.pushTimer);
    const j = Store.data.jobs[0];
    j.status = 'complete'; j.payment = blankPayment(); Store.data.settings.payEtransfer = '';
    Store.save(); clearTimeout(Cloud.pushTimer); await Cloud.syncNow();
    return j.id;
  });
  const B = await dev('Phone');
  const quiet = pg => pg.evaluate(() => clearTimeout(Cloud.pushTimer));
  const server = () => fetch(URL_+'/__state').then(r => r.json()).then(s => s.shops['user-1'].data);
  const modal = pg => pg.evaluate(() => ((document.querySelector('#modal-root .modal') || {}).textContent || '').replace(/\s+/g,' '));

  console.log('--- Nov 13, replayed ---');
  await t('the phone sends the invoice and saves the e-Transfer address', async () => {
    await B.evaluate(async id => {
      const j = Store.job(id);
      Store.setPayment(j, { status:'invoiced' });
      Store.data.settings.payEtransfer = 'office@example.com';
      Store.save(); clearTimeout(Cloud.pushTimer); await Cloud.syncNow();
    }, jid);
    const d = await server();
    if (d.settings.payEtransfer !== 'office@example.com') throw new Error('phone did not save');
  });
  await t('the browser, behind, records the $2,000 part payment — and nothing is lost', async () => {
    await A.evaluate(async id => {
      const j = Store.job(id);
      j.payment.amountPaid = 2000; j.payment.method = 'Interac e-Transfer';
      Store.addLog(j, 'Part payment $2,000.00 by e-Transfer');
      Store.save(); clearTimeout(Cloud.pushTimer); await Cloud.syncNow();
    }, jid);
    await A.waitForTimeout(600);
    if (await modal(A)) throw new Error('it asked: ' + (await modal(A)).slice(0, 200));
    const d = await server();
    const j = d.jobs.find(x => x.id === jid);
    if (j.payment.status !== 'invoiced') throw new Error('sent status lost: ' + j.payment.status);
    if (j.payment.amountPaid !== 2000) throw new Error('payment lost: ' + j.payment.amountPaid);
    if (d.settings.payEtransfer !== 'office@example.com') throw new Error('e-Transfer address lost: "' + d.settings.payEtransfer + '"');
    console.log('       server: invoiced · $2,000 received · e-Transfer address kept');
  });
  await t('and the phone gets the payment on its next sync, with its own changes intact', async () => {
    await B.evaluate(() => Cloud.syncNow()); await B.waitForTimeout(400);
    const r = await B.evaluate(id => { const j = Store.job(id);
      return { st: j.payment.status, paid: j.payment.amountPaid, et: Store.data.settings.payEtransfer }; }, jid);
    if (r.st !== 'invoiced' || r.paid !== 2000 || r.et !== 'office@example.com') throw new Error(JSON.stringify(r));
  });

  console.log('--- the pieces of a merge ---');
  await t('activity logged on both devices keeps both entries', async () => {
    await A.evaluate(async id => { Store.addLog(Store.job(id), 'from the browser'); Store.save(); clearTimeout(Cloud.pushTimer); await Cloud.syncNow(); }, jid);
    await B.evaluate(async id => { Store.addLog(Store.job(id), 'from the phone'); Store.save(); clearTimeout(Cloud.pushTimer); await Cloud.syncNow(); }, jid);
    const log = (await server()).jobs.find(x => x.id === jid).log.map(l => l.text);
    if (!log.includes('from the browser') || !log.includes('from the phone')) throw new Error(log.slice(-4).join(' | '));
  });
  await t('a job made on each device keeps both jobs, and the next number is past both', async () => {
    await A.evaluate(() => Cloud.syncNow()); await B.evaluate(() => Cloud.syncNow());
    const mk = async label => {
      const j = JSON.parse(JSON.stringify(Store.data.jobs[1]));
      j.id = uid('job'); j.no = Store.nextJobNo(); j.description = label;
      Store.data.jobs.push(j); Store.save(); clearTimeout(Cloud.pushTimer); await Cloud.syncNow();
    };
    await A.evaluate(mk, 'made in the browser');
    await B.evaluate(mk, 'made on the phone');
    const d = await server();
    const descs = d.jobs.map(j => j.description);
    if (!descs.includes('made in the browser') || !descs.includes('made on the phone'))
      throw new Error('a job was lost — server has: ' + descs.slice(-3).join(' | ') + ' · B modal: ' + (await modal(B)).slice(0,300) + ' · B state: ' + await B.evaluate(() => Cloud.state + '/' + Cloud.detail));
    const nos = d.jobs.map(j => j.no);
    if (d.counter < Math.max(...nos)) throw new Error('counter ' + d.counter + ' is behind job #' + Math.max(...nos));
  });
  await t('a customer deleted on one device stays deleted if the other did not touch it', async () => {
    await A.evaluate(() => Cloud.syncNow()); await B.evaluate(() => Cloud.syncNow());
    const cid = await A.evaluate(async () => {
      const c = Store.data.customers[Store.data.customers.length - 1];
      Store.data.customers = Store.data.customers.filter(x => x !== c);
      Store.save(); clearTimeout(Cloud.pushTimer); await Cloud.syncNow(); return c.id;
    });
    await B.evaluate(async () => { Store.data.settings.phone = '7805550100'; Store.save(); clearTimeout(Cloud.pushTimer); await Cloud.syncNow(); });
    const d = await server();
    if (d.customers.some(c => c.id === cid)) throw new Error('the deleted customer came back');
    if (d.settings.phone !== '7805550100') throw new Error('the phone change was lost');
  });

  console.log('--- a real clash ---');
  await t('the same field changed differently on both is asked about by name', async () => {
    await A.evaluate(() => Cloud.syncNow()); await B.evaluate(() => Cloud.syncNow());
    await B.evaluate(async id => { const j = Store.job(id); j.payment.amountPaid = 2030; Store.data.settings.website = 'from-phone.example';
      Store.save(); clearTimeout(Cloud.pushTimer); await Cloud.syncNow(); }, jid);
    await A.evaluate(async id => { const j = Store.job(id); j.payment.amountPaid = 2100; Store.data.settings.address = 'from the browser';
      Store.save(); clearTimeout(Cloud.pushTimer); await Cloud.syncNow(); }, jid);
    await A.waitForTimeout(500);
    const m = await modal(A);
    if (!/Job #\d+ · payment · amount paid/.test(m)) throw new Error('does not name it: ' + m.slice(0, 300));
    if (!/2100/.test(m) || !/2030/.test(m)) throw new Error('does not show both values: ' + m.slice(0, 300));
    if (/website|address/i.test(m.replace(/e-Transfer address/,''))) throw new Error('asked about something only one side changed: ' + m.slice(0, 300));
  });
  await t('picking the other device\'s settles that field, and keeps everything else from both', async () => {
    await A.click('[data-conflict="theirs"]'); await A.waitForTimeout(1200);
    const d = await server();
    const j = d.jobs.find(x => x.id === jid);
    if (j.payment.amountPaid !== 2030) throw new Error('amount ' + j.payment.amountPaid);
    if (d.settings.website !== 'from-phone.example') throw new Error('phone-only change lost');
    if (d.settings.address !== 'from the browser') throw new Error('browser-only change lost');
    const st = await A.evaluate(() => ({ s: Cloud.state, open: Cloud.conflictOpen }));
    if (st.s !== 'synced' || st.open) throw new Error(JSON.stringify(st));
  });

  await b.close();
  const hard = errs.filter(e=>e.includes('CONSOLE')||e.includes('PAGEERROR'));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
