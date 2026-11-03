/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1280,height:1100} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  const eid = await pg.evaluate(() => {
    Object.assign(Store.data.settings, { gst:'123456789 RT0001', gstRate:5 });
    const e = Store.data.estimates.find(x => (x.items||[]).length);
    e.status='draft'; delete e.approval;
    if (e.lead) e.lead.email = 'daryl@example.com';
    Store.save(); return e.id;
  });
  const sums = () => pg.evaluate(id => { const e = Store.estimate(id);
    return { sub: Store.estimateTotal(e), tax: Store.estimateTax(e), gross: Store.estimateGross(e) }; }, eid);

  await t('the maths is right and the subtotal stays pre-tax', async () => {
    const n = await sums();
    if (Math.abs(n.tax - n.sub * 0.05) > 0.01) throw new Error(JSON.stringify(n));
    if (Math.abs(n.gross - (n.sub + n.tax)) > 0.01) throw new Error(JSON.stringify(n));
    if (n.gross <= n.sub) throw new Error('gross did not grow');
    console.log('       ' + n.sub + ' + ' + n.tax + ' = ' + n.gross);
  });

  await t('the printed estimate shows subtotal, GST and the real total', async () => {
    await pg.evaluate(id => { $('#print-area').innerHTML = estimateDocHtml(Store.estimate(id)); }, eid);
    const tx = await pg.evaluate(() => document.querySelector('#print-area').textContent.replace(/\s+/g,' '));
    const n = await sums();
    if (!/Subtotal/.test(tx)) throw new Error('no subtotal');
    if (!/GST 5%/.test(tx)) throw new Error('no GST line on the printed estimate');
    if (!tx.includes(money_(n.gross))) throw new Error('total is not the gross figure');
    function money_(v){ return '$' + Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  });

  await t('the message no longer calls a pre-tax number "incl. GST"', async () => {
    await pg.evaluate(id => sendEstimate(id), eid); await pg.waitForTimeout(500);
    const note = await pg.inputValue('#est-note');
    if (/incl\. GST/.test(note)) throw new Error('still claims the total includes tax');
    const n = await sums();
    for (const want of ['Subtotal', 'GST 5%', money_(n.gross)])
      if (!note.includes(want)) throw new Error('"' + want + '" missing from the message');
    function money_(v){ return '$' + Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
    await pg.evaluate(() => closeModal());
  });

  await t('the screen they sign in person shows the tax', async () => {
    await pg.evaluate(id => openEstimateSign(id), eid); await pg.waitForTimeout(500);
    const tx = await pg.evaluate(() => document.querySelector('.modal-body').textContent.replace(/\s+/g,' '));
    const n = await sums();
    if (!/GST 5%/.test(tx)) throw new Error('no GST on the approval screen: ' + tx.slice(0,220));
    if (!tx.includes(money_(n.gross))) throw new Error('not showing what they actually owe');
    function money_(v){ return '$' + Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
    await pg.evaluate(() => closeModal());
  });

  await t('with no GST number nothing mentions tax anywhere', async () => {
    await pg.evaluate(() => { Store.data.settings.gst = ''; Store.save(); });
    await pg.evaluate(id => { $('#print-area').innerHTML = estimateDocHtml(Store.estimate(id)); }, eid);
    const doc = await pg.evaluate(() => document.querySelector('#print-area').textContent);
    if (/GST|Subtotal/.test(doc)) throw new Error('charging tax with no number on file');
    await pg.evaluate(id => openEstimateSign(id), eid); await pg.waitForTimeout(400);
    const tx = await pg.evaluate(() => document.querySelector('.modal-body').textContent);
    if (/GST/.test(tx)) throw new Error('GST on the approval screen with no number');
    const n = await sums();
    if (n.gross !== n.sub) throw new Error('gross differs from subtotal with no tax');
    await pg.evaluate(() => closeModal());
  });

  await t('the estimate and the invoice agree on the number', async () => {
    await pg.evaluate(() => { Store.data.settings.gst = '123456789 RT0001'; Store.save(); });
    const same = await pg.evaluate(id => {
      const e = Store.estimate(id);
      // a job built from this estimate must ask for the same money
      const job = { parts: e.items.map(i => ({ desc:i.desc, qty:i.qty, price:i.price })),
                    laborHours: 0, laborRate: 0, payment: blankPayment() };
      return { est: Store.estimateGross(e), inv: Store.invoiceTotal(job) };
    }, eid);
    if (Math.abs(same.est - same.inv) > 0.01)
      throw new Error('quoted ' + same.est + ' but invoices ' + same.inv);
    console.log('       quoted and invoiced both ' + same.est);
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
