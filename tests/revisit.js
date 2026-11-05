/* Another visit on the same job.

   Renovations balloon. A rough-in runs long, unforeseen drywall comes off,
   he goes back the next day. It is not new work agreed with the customer and
   it is not a new customer — it is the same job continuing — so it carries
   everything forward and bills with the original rather than raising a
   second invoice.

   A fresh job rather than a second date on the old one, because each day has
   its own hours, its own parts and its own photos. Squashing them together
   loses which day the dump run belonged to. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1400,height:950} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error' && !/Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  const jid = await pg.evaluate(() => {
    Store.data.settings.gst = "";
    const j = Store.data.jobs[0];
    Object.assign(j, { status:"in_progress", payment:null, billWith:null, flatPrice:null,
      laborHours: 6, laborRate: 145, scheduledDate: todayStr(),
      type: "Remodel Rough-in", service: "bathroom reno", priority: "High",
      description: "Full ensuite strip-out and rebuild",
      parts: [{ desc:"Dump run", qty:1, price:20 }] });
    Store.save(); return j.id;
  });
  const open = async id => { await pg.evaluate(i => openJob(i), id); await pg.waitForTimeout(400); };

  let kid;
  await t('a job offers another visit', async () => {
    await open(jid);
    const there = await pg.evaluate(() => !!document.querySelector('[data-another-visit]'));
    if (!there) throw new Error('no way to book a return visit');
  });

  await t('it carries the work forward without carrying the money', async () => {
    await pg.click('[data-another-visit]'); await pg.waitForTimeout(500);
    kid = await pg.evaluate(i => {
      const made = Store.data.jobs.filter(j => j.id !== i);
      return made[made.length-1].id;
    }, jid);
    const r = await pg.evaluate(([a,c]) => {
      const p = Store.job(a), k = Store.job(c);
      return { cust: k.customerId === p.customerId, type: k.type === p.type,
               service: k.service === p.service, desc: k.description === p.description,
               pri: k.priority === p.priority, rate: k.laborRate === p.laborRate,
               hours: k.laborHours, parts: (k.parts||[]).length,
               date: k.scheduledDate, status: k.status };
    }, [jid, kid]);
    for (const key of ["cust","type","service","desc","pri","rate"])
      if (!r[key]) throw new Error(key + ' did not carry forward');
    if (r.hours !== 0) throw new Error("it carried yesterday's hours over: " + r.hours);
    if (r.parts !== 0) throw new Error("it carried yesterday's parts over");
    if (r.date) throw new Error('it picked a day for him: ' + r.date);
    if (r.status !== "new") throw new Error('status is ' + r.status);
  });

  await t('and it is one bill, not two', async () => {
    const r = await pg.evaluate(([a,c]) => ({
      billWith: Store.job(c).billWith === a,
      listed: Store.invToSend().some(j => j.id === c)
    }), [jid, kid]);
    if (!r.billWith) throw new Error('the return visit bills on its own');
    if (r.listed) throw new Error('it would raise a second invoice');
  });

  await t('the money adds up across both days', async () => {
    const r = await pg.evaluate(([a,c]) => {
      const k = Store.job(c);
      k.laborHours = 5; k.parts = [{ desc:"Dump run", qty:1, price:20 }];
      Store.save();
      const p = Store.job(a);
      return { parent: Store.jobTotal(p), child: Store.jobTotal(k),
               bill: Store.invoiceTotal(p) };
    }, [jid, kid]);
    const want = (6*145 + 20) + (5*145 + 20);
    if (r.bill !== want) throw new Error('the invoice is ' + r.bill + ', wanted ' + want);
    if (r.parent + r.child !== want) throw new Error('the two days do not sum to the bill');
  });

  await t('each day still counts once in what he earned', async () => {
    const r = await pg.evaluate(([a,c]) => ({
      parent: Store.jobTotal(Store.job(a)), child: Store.jobTotal(Store.job(c))
    }), [jid, kid]);
    if (r.parent !== 6*145 + 20) throw new Error('day one reads ' + r.parent);
    if (r.child !== 5*145 + 20) throw new Error('day two reads ' + r.child);
  });

  await t('it waits in the tray for a day, like anything else unscheduled', async () => {
    await pg.evaluate(() => { closeModal(); App.search=''; go('schedule'); App.scheduleMode='week'; render(); });
    await pg.waitForTimeout(450);
    const there = await pg.evaluate(c => !!document.querySelector(`.tray-strip [data-job="${c}"]`), kid);
    if (!there) throw new Error('the return visit is not in the tray');
  });

  await t('both jobs say what happened, so neither is a mystery later', async () => {
    const r = await pg.evaluate(([a,c]) => ({
      p: (Store.job(a).log||[]).map(l=>l.text||l).join(' | '),
      k: (Store.job(c).log||[]).map(l=>l.text||l).join(' | ')
    }), [jid, kid]);
    if (!/Another visit: job #/i.test(r.p)) throw new Error('day one says nothing: ' + r.p);
    if (!/Return visit on job #/i.test(r.k)) throw new Error('day two says nothing: ' + r.k);
  });

  await t('a third visit hangs off the first job, not off the second', async () => {
    const third = await pg.evaluate(c => {
      const k = Store.anotherVisit(Store.job(c));
      return { id: k.id, billWith: k.billWith };
    }, kid);
    if (third.billWith !== jid)
      throw new Error('it chained off the second visit instead of the original');
  });

  await t('once the invoice has gone out, a return visit bills on its own and says so', async () => {
    const r = await pg.evaluate(a => {
      const p = Store.job(a);
      p.payment = Object.assign(blankPayment(), { status:"invoiced" });
      Store.save();
      const k = Store.anotherVisit(p);
      return { billWith: k.billWith,
               log: (k.log||[]).map(l=>l.text||l).join(' | ') };
    }, jid);
    if (r.billWith) throw new Error('it added work to an invoice already with the customer');
    if (!/Billing on its own/i.test(r.log))
      throw new Error('it did not say why it is separate: ' + r.log);
  });

  await b.close();
  if (errs.length){
    console.log('\n' + errs.length + ' problem(s)');
    errs.forEach(e => console.log('  - ' + e));
    process.exit(1);
  }
  console.log('\nall good');
})();
