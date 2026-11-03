const { chromium } = require(process.env.PW || 'playwright-core');
const APP = 'http://127.0.0.1:54321/index.html';
const URL_ = 'http://127.0.0.1:54321', KEY = 'sb_publishable_test';
const errs = [];

// Exactly the columns Victor reported on public.inquiries.
const BRUCE = { id:1, name:'Bruce Hanlan', contact:'780-555-0142',
  service:'Water Heater', description:"No hot water since last night. 50 gal gas unit in the basement, maybe 12 years old.",
  timing:'Weekday afternoons, not Tuesdays', source:'website', status:'new',
  created_at:'2026-10-26T18:04:00Z' };
const MAILER = { id:2, name:'Priya Raman', contact:'priya.raman@example.com',
  service:'Drain Cleaning', description:'Kitchen sink backing up.',
  timing:'Any evening', source:'website', status:'new',
  created_at:'2026-10-27T01:20:00Z' };

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const post = (p, body) => fetch(URL_+p, { method:'POST', body: JSON.stringify(body) }).then(r=>r.json());
  const get  = p => fetch(URL_+p).then(r=>r.json());

  await get('/__reset');
  await post('/__inq', { rows:[BRUCE, MAILER], mode:'ok' });

  const pg = await b.newPage({ viewport:{width:1280,height:1000} });
  pg.on('pageerror', e => errs.push('PAGEERROR: '+e.message));
  pg.on('console', m => { if (m.type()==='error' && !/Failed to load resource/.test(m.text())) errs.push('CONSOLE: '+m.text()); });
  await pg.goto(APP); await pg.waitForTimeout(400);

  const connect = () => pg.evaluate(([u,k]) => {
    Cloud.cfg = { url:u, key:k, email:'', deviceId:'Test-ab' };
    Cloud.saveCfg(); Cloud.state='signed-out';
    return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow());
  }, [URL_, KEY]);
  const go = async () => { await pg.evaluate(()=>{ App.view='leads'; render(); }); await pg.waitForTimeout(250); };
  const body = () => pg.evaluate(() => document.querySelector('#view').textContent.replace(/\s+/g,' ').trim());

  console.log('--- before connecting ---');
  await t('it says to connect, and still lets him write one down', async () => {
    await go();
    const tx = await body();
    if (!/Not connected to your project/.test(tx)) throw new Error(tx.slice(0,160));
    // The half that needs no connection has to keep working when the other
    // half is the thing that has failed.
    if (!await pg.$('[data-add-lead]'))
      throw new Error('no way to take a lead down while disconnected');
  });

  console.log('--- reading the website table ---');
  await t('syncing the shop also brings the leads down', async () => {
    await connect(); await pg.waitForTimeout(700);
    const n = await pg.evaluate(() => Cloud.inquiries.length);
    if (n !== 2) throw new Error('got ' + n + ' inquiries');
    const err = await pg.evaluate(() => Cloud.inqError);
    if (err) throw new Error('error set: ' + err);
  });

  await t("the app never writes to the website's table", async () => {
    // The mock refuses anything but GET on /rest/v1/inquiries with a 403.
    // A 403 anywhere in this run would have surfaced as a console error.
    const calls = await pg.evaluate(async () => {
      const seen = [];
      const real = window.fetch;
      window.fetch = (u, o) => { seen.push(((o&&o.method)||'GET') + ' ' + String(u)); return real(u, o); };
      await Cloud.pullInquiries();
      window.fetch = real;
      return seen;
    });
    const bad = calls.filter(c => /inquiries/.test(c) && !/^GET /.test(c));
    if (bad.length) throw new Error('wrote to the table: ' + JSON.stringify(bad));
  });

  await t("Victor's column names are read into the app's shape", async () => {
    const l = await pg.evaluate(() => Store.leadsOpen().find(x => x.id === '1'));
    if (!l) throw new Error('Bruce not found');
    if (l.name !== 'Bruce Hanlan') throw new Error('name: ' + l.name);
    if (l.phone !== '780-555-0142') throw new Error('phone: ' + l.phone);
    if (l.email) throw new Error('invented an email: ' + l.email);
    if (l.service !== 'Water Heater') throw new Error('service: ' + l.service);
    if (!/No hot water/.test(l.what)) throw new Error('description lost');
    if (!/not Tuesdays/.test(l.timing)) throw new Error('timing lost');
  });

  await t('contact holding an email is read as an email, not a phone', async () => {
    const l = await pg.evaluate(() => Store.leadsOpen().find(x => x.id === '2'));
    if (l.email !== 'priya.raman@example.com') throw new Error('email: ' + l.email);
    if (l.phone) throw new Error('read an email as a phone number: ' + l.phone);
  });

  await t('newest first, and both are on the screen', async () => {
    await go();
    const names = await pg.$$eval('.stop.lead-card .cust', e => e.map(x => x.textContent.trim()));
    if (names.length !== 2) throw new Error(JSON.stringify(names));
    if (!/Priya/.test(names[0])) throw new Error('not newest first: ' + JSON.stringify(names));
    const tx = await body();
    for (const want of ['No hot water', 'not Tuesdays', '(780) 555-0142']){
      if (!tx.includes(want)) throw new Error('"' + want + '" not shown');
    }
  });

  console.log('--- turning one into work ---');
  await t('Book a job makes the customer and an UNSCHEDULED job', async () => {
    const before = await pg.evaluate(() => Store.data.customers.length);
    await pg.click('[data-lead-job="1"]'); await pg.waitForTimeout(500);
    const r = await pg.evaluate(() => {
      const j = Store.data.jobs[Store.data.jobs.length-1];
      const c = Store.customer(j.customerId);
      return { no:j.no, date:j.scheduledDate, status:j.status, desc:j.description,
               type:j.type, cust:c.name, phone:c.phone, cN:Store.data.customers.length,
               stillOpen: Store.leadsOpen().some(x => x.id === '1') };
    });
    if (r.date !== null) throw new Error('it booked a day by itself: ' + r.date);
    if (r.status !== 'new') throw new Error('status ' + r.status);
    if (r.cust !== 'Bruce Hanlan') throw new Error('customer ' + r.cust);
    if (r.cN !== before + 1) throw new Error('customer not created');
    if (!/No hot water/.test(r.desc)) throw new Error('their words lost: ' + r.desc);
    if (!/not Tuesdays/.test(r.desc)) throw new Error('availability lost from the job');
    if (r.type !== 'Water Heater') throw new Error('type ' + r.type);
    if (r.stillOpen) throw new Error('still sitting in the list');
    console.log('       job #' + r.no + ', ' + r.type + ', no date on it');
  });

  await t('a second inquiry from the same number reuses the customer', async () => {
    await post('/__inq', { rows:[BRUCE, MAILER, Object.assign({}, BRUCE,
      { id:3, name:'Bruce Hanlan', contact:'(780) 555 0142', description:'Now the tap is dripping too.' })] });
    await pg.evaluate(() => closeModal());
    await pg.evaluate(() => Cloud.pullInquiries()); await pg.waitForTimeout(400);
    const before = await pg.evaluate(() => Store.data.customers.length);
    await go();
    await pg.click('[data-lead-job="3"]'); await pg.waitForTimeout(500);
    const after = await pg.evaluate(() => ({ n: Store.data.customers.length,
      cust: Store.customer(Store.data.jobs[Store.data.jobs.length-1].customerId).name }));
    if (after.n !== before) throw new Error('made a duplicate customer');
    if (after.cust !== 'Bruce Hanlan') throw new Error('attached to ' + after.cust);
  });

  await t('Make an estimate starts a draft with them on it', async () => {
    await pg.evaluate(() => closeModal()); await go();
    await pg.click('[data-lead-est="2"]'); await pg.waitForTimeout(500);
    const e = await pg.evaluate(() => {
      const e = Store.data.estimates[Store.data.estimates.length-1];
      return { status:e.status, who:Store.estContact(e).name, mail:Store.estContact(e).email,
               desc:e.description, open: Store.leadsOpen().some(x => x.id === '2') };
    });
    if (e.status !== 'draft') throw new Error('status ' + e.status);
    if (e.who !== 'Priya Raman') throw new Error('contact ' + e.who);
    if (e.mail !== 'priya.raman@example.com') throw new Error('email lost');
    if (!/backing up/.test(e.desc)) throw new Error('their words lost');
    if (e.open) throw new Error('still in the list');
  });

  await t('dealt-with leads move down, and can be put back', async () => {
    await pg.evaluate(() => closeModal()); await go();
    const tx = await body();
    if (!/Already dealt with/.test(tx)) throw new Error('no handled section');
    if (!/job #/.test(tx)) throw new Error('does not say what it became');
    await pg.click('[data-lead-back="1"]'); await pg.waitForTimeout(350);
    if (!await pg.evaluate(() => Store.leadsOpen().some(x => x.id === '1')))
      throw new Error('put back did not work');
  });

  await t('"Not a job" clears it without creating anything', async () => {
    const before = await pg.evaluate(() => Store.data.jobs.length);
    await pg.click('[data-lead-drop="1"]'); await pg.waitForTimeout(350);
    const r = await pg.evaluate(() => ({ jobs: Store.data.jobs.length,
      open: Store.leadsOpen().some(x => x.id === '1') }));
    if (r.jobs !== before) throw new Error('created a job anyway');
    if (r.open) throw new Error('still in the list');
  });

  console.log('--- it stays dealt with ---');
  await t('the handled list survives a reload and rides the shop to sync', async () => {
    const done = await pg.evaluate(() => Object.keys(Store.data.leadsDone).sort().join(','));
    await pg.reload(); await pg.waitForTimeout(900);
    const after = await pg.evaluate(() => Object.keys(Store.data.leadsDone || {}).sort().join(','));
    if (after !== done) throw new Error(done + ' became ' + after);
    const inShop = await pg.evaluate(() => JSON.stringify(Store.data).includes('leadsDone'));
    if (!inShop) throw new Error('not in the shop, so it will not reach his other devices');
  });

  console.log('--- when the table is not reachable ---');
  await t('a missing table says so on this screen and breaks nothing else', async () => {
    await post('/__inq', { mode:'missing' });
    await pg.evaluate(() => Cloud.pullInquiries()); await pg.waitForTimeout(400);
    await go();
    const tx = await body();
    if (!/inquiries/.test(tx) || !/leads SQL/.test(tx)) throw new Error(tx.slice(0,200));
    const shopOk = await pg.evaluate(() => Cloud.state);
    if (shopOk === 'error') throw new Error('it took the whole sync down with it');
  });

  await t('a refused read does not wipe the shop or the sync', async () => {
    await post('/__inq', { mode:'denied' });
    const r = await pg.evaluate(async () => { await Cloud.pullInquiries();
      return { err: Cloud.inqError, state: Cloud.state, jobs: Store.data.jobs.length }; });
    if (!r.err) throw new Error('said nothing');
    if (r.state === 'error') throw new Error('sync marked failed');
    if (!r.jobs) throw new Error('lost the shop');
  });

  console.log('--- the strip on Today ---');
  await t('new leads show on Today without a notification, and go when dealt with', async () => {
    await post('/__inq', { rows:[MAILER], mode:'ok' });
    await pg.evaluate(() => { Store.data.leadsDone = {}; Store.save(); return Cloud.pullInquiries(); });
    await pg.waitForTimeout(400);
    await pg.evaluate(() => { App.view='today'; render(); }); await pg.waitForTimeout(250);
    const strip = await pg.$('.lead-wait');
    if (!strip) throw new Error('no strip on Today');
    if (!/1 new lead/.test(await pg.textContent('.lead-wait'))) throw new Error(await pg.textContent('.lead-wait'));
    await pg.evaluate(() => { Store.leadDone('2','dropped',null); App.view='today'; render(); });
    await pg.waitForTimeout(250);
    if (await pg.$('.lead-wait')) throw new Error('strip stayed after it was dealt with');
  });

  console.log('--- on a phone ---');
  await t('the card reads on a phone with nothing clipped or sideways', async () => {
    const ph = await b.newPage({ viewport:{width:390,height:844} });
    ph.on('pageerror', e => errs.push('PHONE PAGEERROR: '+e.message));
    await ph.goto(APP); await ph.waitForTimeout(400);
    await ph.evaluate(([u,k]) => { Cloud.cfg = { url:u, key:k, email:'', deviceId:'T-ph' };
      Cloud.saveCfg(); return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_, KEY]);
    await ph.waitForTimeout(800);
    await ph.evaluate(() => { Store.data.leadsDone = {}; Store.save(); App.view='leads'; render(); });
    await ph.waitForTimeout(300);
    if (!await ph.$('.stop.lead-card')) throw new Error('no card on the phone');
    const clipped = await ph.$$eval('.stop.lead-card .stop-acts .btn',
      bs => bs.filter(x => x.scrollWidth > x.clientWidth + 1).map(x => x.textContent.trim()));
    if (clipped.length) throw new Error('clipped: ' + JSON.stringify(clipped));
    const over = await ph.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 0) throw new Error('scrolls sideways by ' + over + 'px');
    await ph.close();
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
