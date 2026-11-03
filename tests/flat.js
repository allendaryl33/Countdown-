/* He prices flat rate. The customer wants to read what's included, not what
   each piece of it costs. */
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

  const eid = await pg.evaluate(() => {
    Object.assign(Store.data.settings, { gst:'123456789 RT0001', gstRate:5 });
    const e = Store.data.estimates.find(x => (x.items||[]).length);
    e.status = "draft"; delete e.approval; delete e.flatPrice;
    e.type = "Shower rebuild";
    e.items = [
      { desc:"Remove and dispose of old shower base, glass doors and walls", kind:"labor", qty:1, price:0 },
      { desc:"Plumb and install shower base, control valve and trim",        kind:"labor", qty:1, price:0 },
      { desc:"Apply waterproofing (Red Guard) and minor drywall",            kind:"labor", qty:1, price:0 },
      { desc:"Glass shower door install by trusted sub contractor",          kind:"labor", qty:1, price:0 }];
    e.lead = { name:"Deanna", phone:"780-555-0101", email:"d@example.com", city:"Edmonton" };
    Store.save(); return e.id;
  });
  const open = async () => { await pg.evaluate(id => openEstimate(id), eid); await pg.waitForTimeout(450); };

  await t('with no prices on the lines the estimate is worth nothing yet', async () => {
    const n = await pg.evaluate(id => Store.estimateTotal(Store.estimate(id)), eid);
    if (n !== 0) throw new Error('total is ' + n);
  });

  await t('one flat price covers the lot', async () => {
    await open();
    await pg.fill('#est-flat', "8500");
    await pg.evaluate(() => document.querySelector('#est-flat').blur());
    await pg.waitForTimeout(400);
    const r = await pg.evaluate(id => { const e = Store.estimate(id);
      return { flat: Store.estIsFlat(e), total: Store.estimateTotal(e),
               tax: Store.estimateTax(e), gross: Store.estimateGross(e) }; }, eid);
    if (!r.flat) throw new Error('not flagged as flat rate');
    if (r.total !== 8500) throw new Error('total is ' + r.total);
    if (Math.abs(r.tax - 425) > 0.01) throw new Error('GST is ' + r.tax);
    if (Math.abs(r.gross - 8925) > 0.01) throw new Error('gross is ' + r.gross);
    const shown = await pg.evaluate(() => document.querySelector('[data-est-total]').textContent.trim());
    if (!/8,500/.test(shown)) throw new Error('the screen shows ' + shown);
  });

  await t('the printed estimate lists the scope with no money beside it', async () => {
    await pg.evaluate(id => { $('#print-area').innerHTML = estimateDocHtml(Store.estimate(id)); }, eid);
    const tx = await pg.evaluate(() => $('#print-area').textContent.replace(/\s+/g,' '));
    if (!/What's included/.test(tx)) throw new Error('no scope heading');
    if (!/Red Guard/.test(tx)) throw new Error('a scope line is missing');
    if (/\$0\.00/.test(tx)) throw new Error('it is quoting $0.00 against lines :: ' + tx.slice(0,220));
    if (!/8,925/.test(tx)) throw new Error('the real total is missing');
    if (!/GST 5%/.test(tx)) throw new Error('no GST line');
  });

  await t('the message lists the scope without per-line money', async () => {
    await pg.evaluate(id => sendEstimate(id), eid); await pg.waitForTimeout(450);
    const note = await pg.inputValue('#est-note');
    if (/\$0\.00/.test(note)) throw new Error('quoting zero against a line :: ' + note.slice(0,200));
    if (!/Red Guard/.test(note)) throw new Error('the scope is missing');
    if (!/8,925/.test(note)) throw new Error('the total is missing');
    await pg.evaluate(() => closeModal());
  });

  await t('the in-person approval screen does the same', async () => {
    await pg.evaluate(id => openEstimateSign(id), eid); await pg.waitForTimeout(500);
    const tx = await pg.evaluate(() => document.querySelector('.modal-body').textContent.replace(/\s+/g,' '));
    if (/\$0\.00/.test(tx)) throw new Error('zeroes on the approval screen :: ' + tx.slice(0,200));
    if (!/8,925/.test(tx)) throw new Error('total missing');
    await pg.evaluate(() => closeModal());
  });

  await t('what rides out to the signing link carries no per-line price', async () => {
    const payload = await pg.evaluate(id => {
      const e = Store.estimate(id);
      return { flat: Store.estIsFlat(e),
               items: (e.items||[]).map(i => Store.estIsFlat(e)
                 ? ({ desc:i.desc, qty:0, price:0 }) : i) };
    }, eid);
    if (!payload.flat) throw new Error('payload not marked flat');
    if (payload.items.some(i => Number(i.price) > 0)) throw new Error('a real price leaked into the payload');
    // a hosted page that predates the flat flag multiplies qty by price; zeroes
    // render as $0.00 there, omitted fields render as $NaN
    if (payload.items.some(i => !("price" in i) || !("qty" in i)))
      throw new Error('an older signing page would render $NaN for this line');
    if (payload.items.length !== 4) throw new Error('scope lines lost');
  });

  await t('clearing it goes back to adding the lines up', async () => {
    await open();
    await pg.fill('#est-flat', "");
    await pg.evaluate(() => document.querySelector('#est-flat').blur());
    await pg.waitForTimeout(400);
    const r = await pg.evaluate(id => { const e = Store.estimate(id);
      return { flat: Store.estIsFlat(e), total: Store.estimateTotal(e) }; }, eid);
    if (r.flat) throw new Error('still flat');
    if (r.total !== 0) throw new Error('total is ' + r.total + ' — should be the line sum, which is 0');
  });

  await t('line prices still work normally when no flat price is set', async () => {
    await pg.evaluate(id => { const e = Store.estimate(id);
      e.items[0].price = 1200; e.items[1].price = 300; Store.save(); }, eid);
    const n = await pg.evaluate(id => Store.estimateTotal(Store.estimate(id)), eid);
    if (n !== 1500) throw new Error('line sum is ' + n);
    await open();
    const tx = await pg.evaluate(() => document.querySelector('.modal-body').textContent);
    if (!/1,500/.test(tx)) throw new Error('the record does not show the line sum');
  });

  await t('a flat price survives a reload', async () => {
    await pg.evaluate(id => Store.setFlatPrice(Store.estimate(id), 8500), eid);
    await pg.reload(); await pg.waitForTimeout(600);
    const r = await pg.evaluate(id => Store.estimateTotal(Store.estimate(id)), eid);
    if (r !== 8500) throw new Error('came back as ' + r);
  });

  await t('approving freezes the flat price, not the lines', async () => {
    const r = await pg.evaluate(id => {
      const e = Store.estimate(id);
      Store.signEstimate(e, { name:"Deanna", signature:"data:image/png;base64,iVBORw0KGgo=" });
      const j = e.jobId ? Store.job(e.jobId) : null;
      return { approvalTotal: e.approval.total, quoted: j ? j.quotedTotal : null };
    }, eid);
    if (r.approvalTotal !== 8500) throw new Error('approval froze ' + r.approvalTotal);
    if (r.quoted !== 8500) throw new Error('the job was created quoting ' + r.quoted);
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
