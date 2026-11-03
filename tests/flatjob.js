/* A $2,800 flat quote became a $0.00 job, because the price lived on the
   estimate and only the (zeroed) scope lines crossed over. */
/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1280,height:1000} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  const mk = () => pg.evaluate(() => {
    Object.assign(Store.data.settings, { gst:'', gstRate:5 });
    const e = Store.data.estimates.find(x => (x.items||[]).length);
    e.status = "sent"; delete e.approval; delete e.jobId; e.customerId = null;
    e.items = [{ desc:"shower base", kind:"part", qty:1, price:0 },
               { desc:"shower valve", kind:"part", qty:1, price:0 },
               { desc:"red guard",    kind:"part", qty:1, price:0 }];
    e.flatPrice = 2800;
    e.lead = { name:"test #3", phone:"780-566-2014", city:"Edmonton" };
    Store.save();
    Store.signEstimate(e, { name:"test #3", signature:"data:image/png;base64,iVBORw0KGgo=" });
    return { eid: e.id, jid: e.jobId };
  });

  let ids;
  await t('the job comes across worth what was quoted, not zero', async () => {
    ids = await mk();
    if (!ids.jid) throw new Error('no job was made');
    const r = await pg.evaluate(id => { const j = Store.job(id);
      return { flat: Store.jobIsFlat(j), total: Store.jobTotal(j), quoted: j.quotedTotal }; }, ids.jid);
    if (r.total !== 2800) throw new Error('job total is ' + r.total);
    if (!r.flat) throw new Error('not carried as a flat job');
    if (r.quoted !== 2800) throw new Error('quoted figure is ' + r.quoted);
  });

  await t('so the invoice is for the real money', async () => {
    const r = await pg.evaluate(id => { const j = Store.job(id);
      return { owed: Store.invoiceTotal(j), bal: Store.balance(j) }; }, ids.jid);
    if (r.owed !== 2800) throw new Error('invoice total is ' + r.owed);
    if (r.bal !== 2800) throw new Error('balance is ' + r.bal);
  });

  await t('and it bills the scope with no price against each line', async () => {
    const lines = await pg.evaluate(id => Store.invoiceLines(Store.job(id)), ids.jid);
    if (lines.length !== 3) throw new Error(lines.length + ' lines');
    if (lines.some(l => Number(l.price) > 0)) throw new Error('a line carries a price');
    if (!lines.some(l => /red guard/i.test(l.desc))) throw new Error('scope lost');
  });

  await t('GST rides on the flat price once the number is in', async () => {
    const r = await pg.evaluate(id => {
      Store.data.settings.gst = "123456789 RT0001"; Store.save();
      const j = Store.job(id);
      return { work: Store.jobTotal(j), tax: Store.taxOn(j), owed: Store.invoiceTotal(j) };
    }, ids.jid);
    if (r.work !== 2800) throw new Error('work total ' + r.work);
    if (Math.abs(r.tax - 140) > 0.01) throw new Error('GST is ' + r.tax);
    if (Math.abs(r.owed - 2940) > 0.01) throw new Error('owed is ' + r.owed);
    await pg.evaluate(() => { Store.data.settings.gst = ""; Store.save(); });
  });

  await t('hours logged do not add to a flat bill', async () => {
    const r = await pg.evaluate(id => { const j = Store.job(id);
      j.laborHours = 6; Store.save();
      return { total: Store.jobTotal(j), hrs: j.laborHours }; }, ids.jid);
    if (r.total !== 2800) throw new Error('the flat price moved to ' + r.total);
    if (r.hrs !== 6) throw new Error('the hours were lost');
  });

  await t('the flat price is editable on the job', async () => {
    await pg.evaluate(id => openJob(id), ids.jid); await pg.waitForTimeout(450);
    const there = await pg.evaluate(() => !!document.querySelector('#job-flat'));
    if (!there) throw new Error('no flat price field on the job');
    await pg.fill('#job-flat', "3100");
    await pg.evaluate(() => document.querySelector('#job-flat').blur());
    await pg.waitForTimeout(450);
    const n = await pg.evaluate(id => Store.jobTotal(Store.job(id)), ids.jid);
    if (n !== 3100) throw new Error('job total is ' + n);
  });

  await t('clearing it falls back to adding the lines up', async () => {
    await pg.evaluate(id => { const j = Store.job(id);
      Store.setJobFlatPrice(j, 0);
      j.parts = [{ desc:"valve", qty:2, price:150 }]; j.laborHours = 0; Store.save(); }, ids.jid);
    const n = await pg.evaluate(id => Store.jobTotal(Store.job(id)), ids.jid);
    if (n !== 300) throw new Error('line sum is ' + n);
  });

  await t('an ordinary priced job is untouched', async () => {
    const n = await pg.evaluate(() => {
      const j = Store.data.jobs.find(x => !Store.jobIsFlat(x) && (x.parts||[]).length);
      return j ? Store.jobTotal(j) - Store.jobLineSum(j) : 0;
    });
    if (n !== 0) throw new Error('a normal job total drifted by ' + n);
  });

  console.log('--- what the parts cost him ---');
  await t('typing the parts cost and moving on saves it', async () => {
    const jid = ids.jid;
    await pg.evaluate(id => openJob(id), jid); await pg.waitForTimeout(450);
    await pg.fill('#mat-cost', "500");
    await pg.evaluate(() => document.querySelector('#mat-cost').blur());
    await pg.waitForTimeout(450);
    const n = await pg.evaluate(id => Store.job(id).materialCost, jid);
    if (Number(n) !== 500) throw new Error('it saved ' + n);
  });

  await t('the tick button still works for anyone who presses it', async () => {
    await pg.evaluate(id => openJob(id), ids.jid); await pg.waitForTimeout(450);
    await pg.fill('#mat-cost', "275");
    await pg.click(`[data-save-matcost="${ids.jid}"]`); await pg.waitForTimeout(450);
    const n = await pg.evaluate(id => Store.job(id).materialCost, ids.jid);
    if (Number(n) !== 275) throw new Error('it saved ' + n);
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
