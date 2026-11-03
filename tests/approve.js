/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it if the app lives elsewhere. */
const APP = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1280,height:1100} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${APP}/index.html`); await pg.waitForTimeout(450);

  // A fresh estimate from a website lead — no customer record yet, which is
  // the normal case for work that came in off the form.
  const mk = (name) => pg.evaluate(nm => {
    const src = Store.data.estimates.find(x => (x.items||[]).length);
    const e = JSON.parse(JSON.stringify(src));
    e.id = uid("est"); e.no = Store.nextEstNo(); e.status = "draft";
    delete e.approval; delete e.jobId; e.customerId = null;
    e.lead = { name: nm, phone: "780-555-0" + Math.floor(1000+Math.random()*8999),
               email: "x@example.com", address: "9 Test Ave", city: "Edmonton" };
    Store.data.estimates.push(e); Store.save(); return e.id;
  }, name);

  const est = id => pg.evaluate(i => {
    const e = Store.estimate(i); const j = e.jobId ? Store.job(e.jobId) : null;
    return { status: e.status, jobId: e.jobId || null, customerId: e.customerId || null,
             jobNo: j ? j.no : null, jobDate: j ? j.scheduledDate : null,
             jobTech: j ? j.techId : null, jobStatus: j ? j.status : null };
  }, id);

  await t('approving an estimate makes the job by itself', async () => {
    const id = await mk("Auto Maker");
    await pg.evaluate(i => Store.setEstStatus(Store.estimate(i), "approved"), id);
    const e = await est(id);
    if (e.status !== "approved") throw new Error('status is ' + e.status);
    if (!e.jobId) throw new Error('no job was created on approval');
  });

  await t('the job it makes has no date, so it cannot land on a day he has not looked at', async () => {
    const id = await mk("No Date");
    await pg.evaluate(i => Store.setEstStatus(Store.estimate(i), "approved"), id);
    const e = await est(id);
    if (e.jobDate) throw new Error('it scheduled itself for ' + e.jobDate);
    if (e.jobTech) throw new Error('it assigned a tech too');
    if (e.jobStatus !== 'new') throw new Error('job status is ' + e.jobStatus);
  });

  await t('the job turns up in the unassigned strip above the schedule', async () => {
    const id = await mk("Strip Dweller");
    await pg.evaluate(i => Store.setEstStatus(Store.estimate(i), "approved"), id);
    const e = await est(id);
    await pg.evaluate(() => go("schedule")); await pg.waitForTimeout(350);
    const strip = await pg.evaluate(j => {
      const s = document.querySelector('.tray-strip');
      if (!s) return null;
      return { card: !!s.querySelector('[data-job="'+j+'"]'),
               text: s.textContent.replace(/\s+/g,' ') };
    }, e.jobId);
    if (strip === null) throw new Error('there is no unassigned strip on the schedule');
    if (!strip.card) throw new Error('the job card is not in it :: ' + strip.text.slice(0,200));
    if (!strip.text.includes('Strip Dweller')) throw new Error('card does not name the customer :: ' + strip.text.slice(0,200));
    const head = await pg.evaluate(() => document.querySelector('.tray-head').textContent.replace(/\s+/g,' '));
    if (!/no date/.test(head)) throw new Error('strip heading reads: ' + head);
  });

  await t('a customer record gets made from the lead, so the job has someone on it', async () => {
    const id = await mk("Brand New Person");
    const before = await pg.evaluate(() => Store.data.customers.length);
    await pg.evaluate(i => Store.setEstStatus(Store.estimate(i), "approved"), id);
    const e = await est(id);
    if (!e.customerId) throw new Error('estimate still has no customer');
    const after = await pg.evaluate(() => Store.data.customers.length);
    if (after !== before + 1) throw new Error('customers went ' + before + ' → ' + after);
    const nm = await pg.evaluate(i => Store.customer(Store.estimate(i).customerId).name, id);
    if (nm !== 'Brand New Person') throw new Error('customer is named ' + nm);
  });

  await t('the estimate stays put in Approved', async () => {
    const id = await mk("Still Listed");
    await pg.evaluate(i => Store.setEstStatus(Store.estimate(i), "approved"), id);
    await pg.evaluate(() => { go("estimates"); App.estFilter = "approved"; render(); });
    await pg.waitForTimeout(350);
    const seen = await pg.evaluate(i => !!document.querySelector('[data-estimate="'+i+'"]'), id);
    if (!seen) throw new Error('it vanished out of the Approved list');
  });

  await t('the blue Convert to job button is gone from an approved estimate', async () => {
    const id = await mk("No Button");
    await pg.evaluate(i => Store.setEstStatus(Store.estimate(i), "approved"), id);
    await pg.evaluate(i => openEstimate(i), id); await pg.waitForTimeout(400);
    const n = await pg.evaluate(() => document.querySelectorAll('.modal [data-convert]').length);
    if (n) throw new Error('still offering to convert, ' + n + ' button(s)');
    const tx = await pg.evaluate(() => document.querySelector('.modal-body').textContent);
    if (/Convert to job/i.test(tx)) throw new Error('the words are still on the record');
    // and the row in the list offers nothing either
    await pg.evaluate(() => closeModal()); await pg.waitForTimeout(200);
    await pg.evaluate(() => { go("estimates"); App.estFilter = "approved"; render(); });
    await pg.waitForTimeout(300);
    const rowBtn = await pg.evaluate(i => {
      const r = document.querySelector('[data-estimate="'+i+'"]');
      return r ? r.querySelectorAll('[data-convert]').length : -1;
    }, id);
    if (rowBtn !== 0) throw new Error('the list row has ' + rowBtn + ' convert button(s)');
  });

  await t('approving twice does not make two jobs', async () => {
    const id = await mk("Twice Over");
    const n0 = await pg.evaluate(() => Store.data.jobs.length);
    await pg.evaluate(i => { const e = Store.estimate(i);
      Store.setEstStatus(e, "approved");
      Store.setEstStatus(e, "sent"); Store.setEstStatus(e, "approved");
      Store.jobFromApproved(e);
    }, id);
    const n1 = await pg.evaluate(() => Store.data.jobs.length);
    if (n1 !== n0 + 1) throw new Error('jobs went ' + n0 + ' → ' + n1);
  });

  await t('signing it in person makes the job the same way', async () => {
    const id = await mk("Pen In Hand");
    await pg.evaluate(i => Store.signEstimate(Store.estimate(i),
      { name:"Pen In Hand", role:"Owner", signature:"data:image/png;base64,iVBORw0KGgo=" }), id);
    const e = await est(id);
    if (!e.jobId) throw new Error('signed but no job');
    if (e.jobDate) throw new Error('it picked a date: ' + e.jobDate);
  });

  await t('signing by link makes the job too', async () => {
    const id = await mk("Remote Signer");
    await pg.evaluate(i => Store.signEstimate(Store.estimate(i),
      { name:"Remote Signer", signature:"data:image/png;base64,iVBORw0KGgo=", how:"signing link" }), id);
    const e = await est(id);
    if (!e.jobId) throw new Error('no job off a link signature');
  });

  await t('once the job is invoiced the estimate leaves Approved for All', async () => {
    const id = await mk("Billed Out");
    await pg.evaluate(i => Store.setEstStatus(Store.estimate(i), "approved"), id);
    const e = await est(id);
    await pg.evaluate(j => Store.setPayment(Store.job(j), { status:"invoiced" }), e.jobId);
    const inApproved = await pg.evaluate(i => {
      App.estFilter = "approved"; render();
      return !!document.querySelector('[data-estimate="'+i+'"]');
    }, id);
    await pg.waitForTimeout(250);
    if (inApproved) throw new Error('a billed job still sits in Approved');
    const inAll = await pg.evaluate(i => {
      App.estFilter = "all"; render();
      return !!document.querySelector('[data-estimate="'+i+'"]');
    }, id);
    if (!inAll) throw new Error('and it is not in All either — it is lost');
    const stat = await est(id);
    if (stat.status !== 'approved') throw new Error('its status changed to ' + stat.status);
  });

  await t('the Approved tab count matches the rows the tab shows', async () => {
    await pg.evaluate(() => { App.estFilter = "approved"; render(); }); await pg.waitForTimeout(300);
    const r = await pg.evaluate(() => {
      const tab = [...document.querySelectorAll('[data-est-filter]')]
        .find(x => /Approved/.test(x.textContent));
      const m = tab && tab.textContent.match(/(\d+)/);
      return { badge: m ? +m[1] : null, rows: document.querySelectorAll('[data-estimate]').length };
    });
    if (r.badge === null) throw new Error('no Approved tab found');
    if (r.badge !== r.rows) throw new Error('tab says ' + r.badge + ', list shows ' + r.rows);
  });

  await t('with nothing to make a job from, the rescue button is there instead', async () => {
    const id = await pg.evaluate(() => {
      const e = { id: uid("est"), no: Store.nextEstNo(), createdAt: Date.now(),
        type: "Repair", description: "nothing priced yet", status: "draft",
        items: [], materials: [], customerId: null, log: [],
        lead: { name: "Empty Estimate", phone: "780-555-7777", city: "Edmonton" } };
      Store.data.estimates.push(e); Store.save(); return e.id;
    });
    await pg.evaluate(i => Store.setEstStatus(Store.estimate(i), "approved"), id);
    const e = await est(id);
    if (e.jobId) throw new Error('it made a job out of an empty estimate');
    await pg.evaluate(i => openEstimate(i), id); await pg.waitForTimeout(400);
    const n = await pg.evaluate(() => document.querySelectorAll('.modal [data-convert]').length);
    if (n !== 1) throw new Error('rescue button count is ' + n);
    await pg.evaluate(() => closeModal());
  });

  await t('the saved estimate log says where the job went', async () => {
    const id = await mk("Log Reader");
    await pg.evaluate(i => Store.setEstStatus(Store.estimate(i), "approved"), id);
    const txt = await pg.evaluate(i => (Store.estimate(i).log||[]).map(l=>l.text).join(' | '), id);
    if (!/waiting to be scheduled/i.test(txt)) throw new Error('log reads: ' + txt);
  });

  await t('it survives a reload — the job is really saved, not just on screen', async () => {
    const id = await mk("Persisted");
    await pg.evaluate(i => Store.setEstStatus(Store.estimate(i), "approved"), id);
    const before = await est(id);
    await pg.reload(); await pg.waitForTimeout(500);
    const after = await est(id);
    if (after.jobId !== before.jobId) throw new Error('job id changed across reload');
    if (after.jobDate) throw new Error('it gained a date: ' + after.jobDate);
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
