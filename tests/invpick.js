/* Picking what goes on one invoice, at the moment he is looking at it.

   For a big job or a regular customer he wants one bill covering several
   jobs — 1004, 1005, 1005B — and he wants to decide which at invoice time,
   because that is when he knows whether she wants one bill or three. The
   grouping already existed; choosing it afterwards did not.

   Invoicing straight from a single job still has to work untouched: most
   jobs are small and that is the faster path. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1400,height:1000} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error' && !/Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  /* Three days of Deanna's reno, plus somebody else's job. */
  const ids = await pg.evaluate(() => {
    Store.data.settings.gst = "";
    const a = Store.data.jobs[0];
    Object.assign(a, { status:"complete", payment:null, billWith:null, flatPrice:null,
      laborHours:4, laborRate:145, parts:[], type:"Remodel Rough-in", service:"bathroom reno" });
    const mk = (over) => {
      const j = Object.assign({}, a, { id: uid("job"), no: Store.nextJobNo(),
        parts: [], timeEntries: [], payment: null, billWith: null, log: [] }, over);
      Store.data.jobs.push(j); return j;
    };
    const b2 = mk({ laborHours: 6 });
    // a real second customer, or the app rightly refuses to invoice at all
    const them = Store.data.customers.find(c => c.id !== a.customerId);
    const other = mk({ laborHours: 2, customerId: them.id });
    Store.save();
    return { a: a.id, b: b2.id, other: other.id };
  });
  const open = async id => { await pg.evaluate(i => previewInvoice(i), id); await pg.waitForTimeout(500); };
  const picker = () => pg.evaluate(() => {
    const box = document.querySelector('.invpick');
    if (!box) return null;
    return Array.from(box.querySelectorAll('input[type=checkbox]')).map(c => ({
      on: c.checked, disabled: c.disabled,
      who: (c.closest('label')||{}).innerText || '', key: c.dataset.invJoin || ''
    }));
  });

  await t('the invoice offers her other work, and nobody else’s', async () => {
    await open(ids.a);
    const rows = await picker();
    if (!rows) throw new Error('no picker on the invoice');
    const keys = rows.map(r => r.key).join(' ');
    if (!keys.includes(ids.b)) throw new Error('her other job is not offered');
    if (keys.includes(ids.other)) throw new Error("another customer's job was offered");
  });

  await t('the job being invoiced is on it and cannot be unticked', async () => {
    const rows = await picker();
    const self = rows.find(r => r.disabled);
    if (!self) throw new Error('the job itself is not shown as on the invoice');
    if (!self.on) throw new Error('the job itself is shown as off its own invoice');
  });

  await t('ticking one adds it, and the invoice total follows', async () => {
    const before = await pg.evaluate(i => Store.invoiceTotal(Store.job(i)), ids.a);
    await pg.click(`[data-inv-join="${ids.b}:${ids.a}"]`);
    await pg.waitForTimeout(600);
    const after = await pg.evaluate(i => Store.invoiceTotal(Store.job(i)), ids.a);
    if (before !== 4*145) throw new Error('setup: started at ' + before);
    if (after !== (4+6)*145) throw new Error('invoice total is ' + after + ', wanted ' + (10*145));
  });

  await t('and the document underneath shows both days', async () => {
    const doc = await pg.evaluate(() => (document.querySelector('.inv-preview')||{}).innerText || '');
    if (!/Added:/.test(doc)) throw new Error('the second job is not itemised on the invoice');
    const want = (10*145).toLocaleString('en-US', { minimumFractionDigits: 2 });
    if (!doc.includes(want)) throw new Error('the printed total is not ' + want);
  });

  await t('unticking takes it back off', async () => {
    await pg.click(`[data-inv-join="${ids.b}:${ids.a}"]`);
    await pg.waitForTimeout(600);
    const r = await pg.evaluate(([a,c]) => ({
      total: Store.invoiceTotal(Store.job(a)), billWith: Store.job(c).billWith
    }), [ids.a, ids.b]);
    if (r.billWith) throw new Error('it is still attached');
    if (r.total !== 4*145) throw new Error('total is ' + r.total);
  });

  await t('a job already invoiced is never offered to join another', async () => {
    await pg.evaluate(c => {
      Store.job(c).payment = Object.assign(blankPayment(), { status:"invoiced" });
      Store.save();
    }, ids.b);
    await open(ids.a);
    const rows = await picker();
    const keys = (rows||[]).map(r => r.key).join(' ');
    if (keys.includes(ids.b))
      throw new Error('offered to fold in work the customer has already been billed for');
  });

  await t('a job worth nothing on its own can still be invoiced once work is added', async () => {
    const r = await pg.evaluate(([a,c]) => {
      const p = Store.job(a), k = Store.job(c);
      k.payment = null; k.billWith = null;
      p.laborHours = 0; p.parts = [];          // the parent is now worth nothing
      Store.save();
      return { own: Store.jobTotal(p), billed: Store.billedTotal(p) };
    }, [ids.a, ids.b]);
    if (r.own !== 0) throw new Error('setup: parent is worth ' + r.own);
    await open(ids.a);
    let blocked = await pg.evaluate(() =>
      /Not ready to invoice/i.test((document.querySelector('.modal-body')||{}).innerText||''));
    if (!blocked) throw new Error('setup: it should refuse while nothing is on it');
    await pg.click(`[data-inv-join="${ids.b}:${ids.a}"]`);
    await pg.waitForTimeout(600);
    blocked = await pg.evaluate(() =>
      /Not ready to invoice/i.test((document.querySelector('.modal-body')||{}).innerText||''));
    if (blocked) throw new Error('it still refuses even though there is now work on the invoice');
  });

  await t('invoicing a single job on its own still works, untouched', async () => {
    await pg.evaluate(i => { closeModal(); Store.billSeparately(Store.job(i)); }, ids.b);
    await open(ids.other);
    const r = await pg.evaluate(i => ({
      total: Store.invoiceTotal(Store.job(i)),
      shown: (document.querySelector('.inv-preview')||{}).innerText || ''
    }), ids.other);
    if (r.total !== 2*145) throw new Error('the lone job invoices ' + r.total);
    if (!r.shown) throw new Error('no invoice document for a lone job');
  });

  await b.close();
  if (errs.length){
    console.log('\n' + errs.length + ' problem(s)');
    errs.forEach(e => console.log('  - ' + e));
    process.exit(1);
  }
  console.log('\nall good');
})();
