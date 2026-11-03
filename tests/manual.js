const { chromium } = require(process.env.PW || 'playwright-core');
const APP='http://127.0.0.1:54321/index.html', URL_='http://127.0.0.1:54321', KEY='sb_publishable_test';
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  await fetch(URL_+'/__reset');
  const pg = await b.newPage({ viewport:{width:1280,height:1100} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text())});
  await pg.goto(APP); await pg.waitForTimeout(400);
  const go = async () => { await pg.evaluate(() => { App.view='leads'; App.search=''; render(); }); await pg.waitForTimeout(300); };
  const body = () => pg.evaluate(() => document.querySelector('#view').textContent.replace(/\s+/g,' ').trim());

  await t('the button is there even with no connection at all', async () => {
    await go();
    if (!await pg.$('[data-add-lead]')) throw new Error('no add button');
  });

  await t('it refuses without a name', async () => {
    await pg.click('[data-add-lead]'); await pg.waitForTimeout(400);
    await pg.click('[data-save-manual-lead]'); await pg.waitForTimeout(300);
    if (!await pg.isVisible('#ml-name-err')) throw new Error('took a nameless lead');
    const n = await pg.evaluate(() => Store.data.manualLeads.length);
    if (n) throw new Error('saved anyway');
  });

  let id;
  await t('a phoned-in lead lands in the same list', async () => {
    await pg.fill('#ml-name', 'Marcy Dunn');
    await pg.fill('#ml-phone', '780-555-0199');
    await pg.fill('#ml-what', 'Water backing up in the basement floor drain.');
    await pg.fill('#ml-timing', 'Any weekday after 4');
    await pg.fill('#ml-address', 'Glenora');
    await pg.selectOption('#ml-service', { index: 1 });
    await pg.selectOption('#ml-source', 'phone call');
    await pg.click('[data-save-manual-lead]'); await pg.waitForTimeout(600);
    const l = await pg.evaluate(() => Store.leadsOpen()[0]);
    if (!l || l.name !== 'Marcy Dunn') throw new Error('not in the list: ' + JSON.stringify(l));
    if (!/^man_/.test(l.id)) throw new Error('id could collide with a website one: ' + l.id);
    if (l.source !== 'phone call') throw new Error('source ' + l.source);
    id = l.id;
    const tx = await body();
    if (!/Marcy Dunn/.test(tx)) throw new Error('not drawn');
    if (!/phone call/.test(tx)) throw new Error('does not say where it came from');
    if (!/backing up/.test(tx)) throw new Error('their words lost');
  });

  await t('it books into a job exactly like a website one', async () => {
    await pg.click(`[data-lead-job="${id}"]`); await pg.waitForTimeout(700);
    const r = await pg.evaluate(() => {
      const j = Store.data.jobs[Store.data.jobs.length-1];
      return { date:j.scheduledDate, cust:Store.customer(j.customerId).name,
               phone:Store.customer(j.customerId).phone, desc:j.description,
               from:j.fromLead, log:j.log.map(x=>x.text).join(' | ') };
    });
    if (r.date !== null) throw new Error('it booked a day by itself');
    if (r.cust !== 'Marcy Dunn') throw new Error('customer ' + r.cust);
    if (!/555/.test(r.phone)) throw new Error('phone lost: ' + r.phone);
    if (!/backing up/.test(r.desc)) throw new Error('their words lost');
    if (!/after 4/.test(r.desc)) throw new Error('availability lost');
    if (r.from !== id) throw new Error('job does not remember the lead');
    if (!/phone call inquiry/.test(r.log)) throw new Error('log: ' + r.log);
    await pg.evaluate(() => closeModal());
  });

  await t('it survives a reload and rides the shop to his other devices', async () => {
    const before = await pg.evaluate(() => Store.data.manualLeads.length);
    await pg.reload(); await pg.waitForTimeout(700);
    const after = await pg.evaluate(() => (Store.data.manualLeads||[]).length);
    if (after !== before) throw new Error(before + ' became ' + after);
    const inShop = await pg.evaluate(() => JSON.stringify(Store.data).includes('manualLeads'));
    if (!inShop) throw new Error('not in the shop');
  });

  await t('a typo can be deleted outright, a website lead cannot', async () => {
    await pg.evaluate(() => { Store.data.leadsDone = {}; Store.save(); });
    await go();
    if (!await pg.$(`[data-lead-forget="${id}"]`)) throw new Error('no delete on a hand-written one');
    // a website lead must not offer it
    await fetch(URL_+'/__inq', { method:'POST', body: JSON.stringify({ rows:[
      { id:11, name:'Web Person', contact:'780-555-0111', description:'x', source:'website' }] }) });
    await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'T'}; Cloud.saveCfg();
      return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY]);
    await pg.waitForTimeout(900);
    await go();
    if (await pg.$('[data-lead-forget="11"]')) throw new Error('offered to delete a website row');
    await pg.click(`[data-lead-forget="${id}"]`); await pg.waitForTimeout(400);
    const gone = await pg.evaluate(i => !Store.leads().some(l => l.id === i), id);
    if (!gone) throw new Error('delete did nothing');
  });

  await t('website and hand-written leads sit in one list together', async () => {
    await pg.evaluate(() => { Store.addManualLead({ name:'Called In', source:'referral' });
      Store.data.leadsDone = {}; Store.save(); });
    await go();
    const names = await pg.$$eval('.stop.lead-card .cust', e => e.map(x => x.textContent.replace(/\s+/g,' ').trim()));
    if (!names.some(n => /Web Person/.test(n))) throw new Error('website one missing: ' + JSON.stringify(names));
    if (!names.some(n => /Called In/.test(n))) throw new Error('hand-written one missing');
    if (!names.some(n => /referral/.test(n))) throw new Error('source not shown');
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
