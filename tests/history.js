/* Two questions: does the bottom bar read in the order he works, and does a
   customer card really accumulate everything over the years? */
/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:430,height:900} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  await t('the bottom bar runs in the order the work runs', async () => {
    const order = await pg.evaluate(() =>
      [...document.querySelectorAll('#mobile-nav [data-nav]')].map(b => b.dataset.nav));
    const want = ["today","estimates","schedule","jobs","invoices"];
    if (order.join(",") !== want.join(",")) throw new Error('bar reads ' + order.join(" → "));
  });

  await t('every tab still goes where it says', async () => {
    for (const id of ["today","estimates","schedule","jobs","invoices"]){
      await pg.click(`#mobile-nav [data-nav="${id}"]`); await pg.waitForTimeout(250);
      const v = await pg.evaluate(() => App.view);
      if (v !== id) throw new Error('"' + id + '" opened ' + v);
    }
  });

  await t('Customers is reachable from More', async () => {
    const there = await pg.evaluate(() => {
      const v = VIEWS.find(x => x.id === "customers");
      return v ? v.label : null;
    });
    if (there !== "Customers") throw new Error('no customers view');
    await pg.evaluate(() => go("customers")); await pg.waitForTimeout(350);
    if (await pg.evaluate(() => App.view) !== "customers") throw new Error('could not open it');
  });

  // --- one customer, work spread over two years ---
  const cid = await pg.evaluate(() => {
    const c = { id: uid("cus"), name:"Repeat Custom", phone:"780-555-4242", email:"r@example.com",
      address:"3 Return Rd", city:"Edmonton", zone:"city", notes:"", createdAt: Date.now() };
    Store.data.customers.push(c);
    const YEAR = 365*86400000;
    [2, 1, 0].forEach((back, i) => {
      const e = { id: uid("est"), no: Store.nextEstNo(), createdAt: Date.now() - back*YEAR,
        type: "Visit " + (i+1), description:"", status:"approved", items:[{desc:"Work",qty:1,price:100*(i+1)}],
        materials:[], customerId: c.id, log:[] };
      Store.data.estimates.push(e);
      Store.data.jobs.push({ id: uid("job"), no: Store.nextJobNo(), createdAt: e.createdAt,
        customerId: c.id, type: e.type, priority:"Normal", description:"",
        scheduledDate: new Date(e.createdAt).toISOString().slice(0,10), window:"Anytime",
        techId:null, status:"complete", completedAt: e.createdAt, laborHours:0,
        laborRate:145, payment: blankPayment(), timeEntries:[],
        parts:[{desc:"Work",qty:1,price:100*(i+1)}], materials:[], estimateId:e.id,
        quotedTotal: 100*(i+1), log:[] });
    });
    Store.save(); return c.id;
  });

  await t('the card holds every job and every estimate, years apart', async () => {
    const r = await pg.evaluate(id => ({
      jobs: Store.jobsForCustomer(id).length,
      ests: Store.estimatesForCustomer(id).length }), cid);
    if (r.jobs !== 3) throw new Error('jobs on file: ' + r.jobs);
    if (r.ests !== 3) throw new Error('estimates on file: ' + r.ests);
  });

  await t('and the card itself shows them, not just the data', async () => {
    await pg.evaluate(id => openCustomer(id), cid); await pg.waitForTimeout(500);
    const tx = await pg.evaluate(() => document.querySelector('#modal-root').textContent.replace(/\s+/g,' '));
    for (const w of ["Service history", "Estimates", "Visit 1", "Visit 2", "Visit 3"])
      if (!tx.includes(w)) throw new Error('"' + w + '" missing from the card');
    if (!/Lifetime billed/.test(tx)) throw new Error('no lifetime total');
    await pg.evaluate(() => closeModal());
  });

  await t('a repeat inquiry lands on the same card, not a new one', async () => {
    const r = await pg.evaluate(() => {
      const before = Store.data.customers.length;
      const c = Store.customerFromLead({ name:"Repeat Custom", phone:"780-555-4242",
        email:"r@example.com", address:"3 Return Rd" });
      return { same: c.name === "Repeat Custom",
               grew: Store.data.customers.length - before, id: c.id };
    });
    if (r.grew !== 0) throw new Error('it made ' + r.grew + ' extra customer record(s)');
    if (r.id !== cid) throw new Error('matched a different record');
  });

  await t('six months on, the new work joins the same history', async () => {
    const n = await pg.evaluate(id => {
      const e = { id: uid("est"), no: Store.nextEstNo(), createdAt: Date.now(),
        type:"Visit 4 — six months later", description:"", status:"approved",
        items:[{desc:"More work",qty:1,price:400}], materials:[], customerId:id, log:[] };
      Store.data.estimates.push(e); Store.save();
      return Store.estimatesForCustomer(id).length;
    }, cid);
    if (n !== 4) throw new Error('history did not grow, it holds ' + n);
    await pg.evaluate(id => openCustomer(id), cid); await pg.waitForTimeout(450);
    const tx = await pg.evaluate(() => document.querySelector('#modal-root').textContent);
    if (!/six months later/.test(tx)) throw new Error('the new estimate is not on the card');
    await pg.evaluate(() => closeModal());
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
