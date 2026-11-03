/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1200,height:1000} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  const jid = await pg.evaluate(() => {
    const j = Store.data.jobs.find(x => x.status === 'complete' && x.parts && x.parts.length);
    j.laborHours = 2; j.laborRate = 145; Store.save();
    return j.id;
  });
  const text = () => pg.evaluate(() => (document.querySelector('.inv-preview')||{textContent:''})
    .textContent.replace(/\s+/g,' ').trim());

  console.log('--- before he is GST registered ---');
  await t('no tax line at all, because charging it would be illegal', async () => {
    await pg.evaluate(() => { Store.data.settings.gst = ''; Store.save(); });
    await pg.evaluate(id => previewInvoice(id), jid); await pg.waitForTimeout(700);
    const tx = await text();
    if (/GST/i.test(tx)) throw new Error('GST shown with no registration number');
    const nums = await pg.evaluate(id => ({ sub: Store.jobTotal(Store.job(id)),
      tax: Store.taxOn(Store.job(id)), total: Store.invoiceTotal(Store.job(id)) }), jid);
    if (nums.tax !== 0) throw new Error('tax computed anyway: ' + nums.tax);
    if (nums.total !== nums.sub) throw new Error('total differs from subtotal');
    console.log('       subtotal = total = ' + nums.total + ', no GST anywhere');
  });

  console.log('--- once registered ---');
  await t('GST appears, at the rate set, with the number on the page', async () => {
    await pg.evaluate(() => {
      Object.assign(Store.data.settings, { gst:'123456789 RT0001', gstRate:5 }); Store.save(); closeModal();
    });
    await pg.evaluate(id => previewInvoice(id), jid); await pg.waitForTimeout(700);
    const tx = await text();
    if (!/GST 5%/.test(tx)) throw new Error('no GST line: ' + tx.slice(0,200));
    if (!/123456789 RT0001/.test(tx)) throw new Error('registration number not printed');
    const n = await pg.evaluate(id => {
      const j = Store.job(id);
      return { sub: Store.jobTotal(j), tax: Store.taxOn(j), total: Store.invoiceTotal(j) };
    }, jid);
    if (Math.abs(n.tax - n.sub * 0.05) > 0.01) throw new Error('tax maths: ' + JSON.stringify(n));
    if (Math.abs(n.total - (n.sub + n.tax)) > 0.01) throw new Error('total maths: ' + JSON.stringify(n));
    console.log('       ' + n.sub + ' + ' + n.tax + ' = ' + n.total);
  });

  await t('Time & Money still counts revenue before tax', async () => {
    const n = await pg.evaluate(id => ({
      earns: Store.jobTotal(Store.job(id)), owes: Store.invoiceTotal(Store.job(id)) }), jid);
    if (n.earns >= n.owes) throw new Error('jobTotal picked up the tax: ' + JSON.stringify(n));
    console.log('       he earns ' + n.earns + ', customer owes ' + n.owes);
  });

  await t('what the customer owes includes the tax', async () => {
    const bal = await pg.evaluate(id => {
      const j = Store.job(id); j.payment.amountPaid = 0; Store.save();
      return { bal: Store.balance(j), total: Store.invoiceTotal(j) }; }, jid);
    if (Math.abs(bal.bal - bal.total) > 0.01) throw new Error(JSON.stringify(bal));
  });

  console.log('--- the number on it ---');
  await t('an invoice number is assigned once and never moves', async () => {
    const first = await pg.evaluate(id => Store.job(id).invoiceNo, jid);
    if (!first) throw new Error('no number assigned');
    await pg.evaluate(() => closeModal());
    await pg.evaluate(id => previewInvoice(id), jid); await pg.waitForTimeout(600);
    const second = await pg.evaluate(id => Store.job(id).invoiceNo, jid);
    if (second !== first) throw new Error('renumbered ' + first + ' -> ' + second);
    console.log('       INV-' + first + ' twice');
  });

  await t('a second job gets the next number, not the same one', async () => {
    const other = await pg.evaluate(() => {
      const j = Store.data.jobs.find(x => x.status === 'complete' && !x.invoiceNo && x.parts.length);
      return j ? j.id : null; });
    if (!other) { console.log('       (no second billable job in the sample)'); return; }
    await pg.evaluate(() => closeModal());
    await pg.evaluate(id => previewInvoice(id), other); await pg.waitForTimeout(600);
    const n = await pg.evaluate(([a,b]) => [Store.job(a).invoiceNo, Store.job(b).invoiceNo], [jid, other]);
    if (n[0] === n[1]) throw new Error('two jobs share INV-' + n[0]);
    console.log('       INV-' + n[0] + ' and INV-' + n[1]);
  });

  console.log('--- what is on it ---');
  await t('the work, the money and the due date are all there', async () => {
    await pg.evaluate(() => closeModal());
    await pg.evaluate(id => previewInvoice(id), jid); await pg.waitForTimeout(700);
    const tx = await text();
    for (const want of ['INVOICE','Billed to','Subtotal','Total','Payment due','What was wrong']){
      if (!tx.includes(want)) throw new Error('missing "' + want + '"');
    }
    if (!/Poseidon/.test(tx)) throw new Error('no company name');
    console.log('       letterhead, billed-to, lines, totals, due date');
  });

  await t('labelled photos are included, unlabelled ones are not', async () => {
    await pg.evaluate(() => closeModal());
    await pg.evaluate(async id => {
      const mk = () => new Promise(r => { const cv=document.createElement('canvas');
        cv.width=800;cv.height=600;const g=cv.getContext('2d');g.fillStyle='#246';g.fillRect(0,0,800,600);
        cv.toBlob(x=>r(new File([x],'p.jpg',{type:'image/jpeg'})),'image/jpeg',.9); });
      await takePhotos('job', id, [await mk(), await mk(), await mk()]);
      const ps = Store.photosOf(Store.job(id));
      Store.setPhoto('job', id, ps[0].id, { tag:'before' });
      Store.setPhoto('job', id, ps[1].id, { tag:'after' });
      // ps[2] deliberately left unlabelled — a model plate, for him not them
    }, jid);
    await pg.waitForTimeout(900);
    await pg.evaluate(id => previewInvoice(id), jid); await pg.waitForTimeout(1200);
    const n = await pg.evaluate(() => document.querySelectorAll('.inv-preview .inv-grid figure').length);
    if (n !== 2) throw new Error('showing ' + n + ' photos, expected the 2 labelled ones');
    console.log('       2 labelled in, 1 unlabelled left out');
  });

  await t('what they signed is listed', async () => {
    await pg.evaluate(() => closeModal());
    await pg.evaluate(id => {
      const j = Store.job(id);
      Store.signWaiver(Store.data.waiverTemplates[0], { job:j, signerName:'Dave Broadfoot', signerRole:'Owner' });
    }, jid);
    await pg.evaluate(id => previewInvoice(id), jid); await pg.waitForTimeout(900);
    const tx = await text();
    if (!/Signed on this job/.test(tx)) throw new Error('no waiver section');
    if (!/Dave Broadfoot/.test(tx)) throw new Error('signer not named');
    console.log('       waiver and signer shown');
  });

  await t('a payment link shows when there is one', async () => {
    await pg.evaluate(() => closeModal());
    await pg.evaluate(id => { Store.job(id).payment.url = 'https://pay.stripe.com/x/abc123'; Store.save(); }, jid);
    await pg.evaluate(id => previewInvoice(id), jid); await pg.waitForTimeout(800);
    const tx = await text();
    if (!/pay\.stripe\.com/.test(tx)) throw new Error('payment link not shown');
  });

  console.log('--- guard rails ---');
  await t('an empty job is refused rather than sent blank', async () => {
    await pg.evaluate(() => closeModal());
    const empty = await pg.evaluate(() => {
      const j = Store.data.jobs.find(x => !x.parts.length && !x.laborHours);
      return j ? j.id : null; });
    if (!empty){ console.log('       (no empty job in the sample)'); return; }
    await pg.evaluate(id => previewInvoice(id), empty); await pg.waitForTimeout(600);
    const tx = await pg.evaluate(() => (document.querySelector('.modal-body')||{textContent:''}).textContent);
    if (!/Not ready to invoice/.test(tx)) throw new Error('offered to send an empty invoice');
    const assigned = await pg.evaluate(id => !!Store.job(id).invoiceNo, empty);
    if (assigned) throw new Error('burned an invoice number on a job it refused');
    console.log('       refused, and no number wasted');
  });

  await t('the preview is what prints', async () => {
    await pg.evaluate(() => closeModal());
    await pg.evaluate(id => printInvoice(id), jid).catch(()=>{});
    await pg.waitForTimeout(1500);
    const pr = await pg.evaluate(() => document.querySelector('#print-area').textContent.replace(/\s+/g,' '));
    for (const want of ['INVOICE','Subtotal','GST 5%','Dave Broadfoot','pay.stripe.com']){
      if (!pr.includes(want)) throw new Error('"' + want + '" missing from the printed copy');
    }
    const imgs = await pg.evaluate(() => document.querySelectorAll('#print-area img').length);
    if (imgs !== 2) throw new Error('photos did not reach the print copy: ' + imgs);
    console.log('       print copy matches, photos included');
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
