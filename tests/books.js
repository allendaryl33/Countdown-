/* What goes to the bookkeeper: three CSV files for a period.

   Nov 16: his bookkeeper does the books in QuickBooks; he wants to hand
   over records clean enough that the bookkeeper's hours stay short.
   Invoices with GST split out, each payment with its date and method, and
   the receipts entered against jobs — all of it, including what was in the
   app before this existed. These tests download the files the way he would
   and read them back.                                                   */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const fs = require('fs');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP=`file://${REPO_DIR}/index.html`, errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const ctx = await b.newContext({ viewport:{width:1280,height:1000}, acceptDownloads:true });
  const pg = await ctx.newPage();
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await pg.goto(APP); await pg.waitForTimeout(500);
  await pg.evaluate(()=>localStorage.clear()); await pg.reload(); await pg.waitForTimeout(400);

  /* Read a CSV back: strip the BOM, split quoted cells. */
  const parse = text => {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return text.split('\r\n').map(line => {
      const out = []; let cur = '', q = false;
      for (let i = 0; i < line.length; i++){
        const ch = line[i];
        if (q){ if (ch === '"' && line[i+1] === '"'){ cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
        else if (ch === '"') q = true; else if (ch === ','){ out.push(cur); cur = ''; } else cur += ch;
      }
      out.push(cur); return out;
    });
  };
  const grab = async (which, from, to) => {
    await pg.evaluate(([f, tt]) => { go('data'); }, [from, to]); await pg.waitForTimeout(250);
    await pg.fill('#bk-from', from || ''); await pg.fill('#bk-to', to || '');
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click(`[data-books="${which}"]`)]);
    const raw = fs.readFileSync(await dl.path(), 'utf8');
    return { name: dl.suggestedFilename(), raw, rows: parse(raw) };
  };
  const col = (rows, name) => rows[0].indexOf(name);

  /* Two invoiced jobs, one still open, and one with receipts. */
  const ids = await pg.evaluate(() => {
    Object.assign(Store.data.settings, { gst:'123456789 RT0001', gstRate:5 });
    const js = Store.data.jobs;
    js.forEach(j => { j.payment = blankPayment(); j.materials = []; j.billWith = null; j.invoiceNo = null; j.invoicedOn = null; });
    const a = js[0], o = js[1], legacy = js[2];
    Store.customer(a.customerId).name = '=SUM(A1)';               // a name Excel would run as a formula
    a.status = 'complete'; a.parts = [{ desc:'Work', qty:1, price:320.15 }]; a.laborHours = 0; a.flatPrice = null;
    Store.invoiceNoFor(a); Store.setPayment(a, { status:'invoiced' });
    a.materials = [
      { id:'r1', text:'1/2" PEX elbow', qty:3, cost:1.115, got:true, gotAt: Date.parse('2026-11-10T12:00:00'), addedAt:1, from:'job' },
      { id:'r2', text:'GST', qty:1, cost:0.17, got:true, gotAt: Date.parse('2026-11-10T12:00:00'), addedAt:2, from:'job' },
      { id:'r3', text:'Not costed yet', qty:1, cost:null, got:false, addedAt:3, from:'job' }
    ];
    // paid from before payments were dated: no history, marked paid on a known day
    legacy.status = 'complete'; legacy.parts = [{ desc:'Work', qty:1, price:100 }]; legacy.laborHours = 0; legacy.flatPrice = null;
    Store.invoiceNoFor(legacy);
    legacy.payment = Object.assign(blankPayment(), { status:'invoiced', amountPaid: 40, method:'Cash', invoicedAt: Date.parse('2026-11-03T10:00:00') });
    legacy.invoicedOn = '2026-11-03';
    o.status = 'scheduled';                                          // not invoiced: stays out
    Store.save();
    return { a: a.id, aNo: a.no, legacy: legacy.id, o: o.id, oNo: o.no };
  });

  console.log('--- payments, written down one by one ---');
  await t('a part payment and then the rest are two dated lines, not one running total', async () => {
    await pg.evaluate(id => {
      const j = Store.job(id);
      Store.setPayment(j, { status:'invoiced', amountPaid: 100, method:'Interac e-Transfer' });
      Store.setPayment(j, { status:'paid', amountPaid: Store.invoiceTotal(j), method:'Card', ref:'pi_123' });
    }, ids.a);
    const h = await pg.evaluate(id => Store.job(id).payment.history, ids.a);
    if (h.length !== 2) throw new Error(JSON.stringify(h));
    if (h[0].amount !== 100 || h[0].method !== 'Interac e-Transfer') throw new Error(JSON.stringify(h[0]));
    if (h[1].amount !== 236.16 || h[1].method !== 'Card' || h[1].ref !== 'pi_123') throw new Error(JSON.stringify(h[1]));
  });

  console.log('--- the files ---');
  let inv, pay, rec;
  await t('Invoices: GST split out, totals to the cent, only work that was invoiced', async () => {
    inv = await grab('invoices');
    const r = inv.rows;
    const row = r.find(x => x[col(r,'PO')] === String(ids.aNo));
    if (!row) throw new Error('invoice missing: ' + inv.raw.slice(0, 300));
    const v = n => row[col(r, n)];
    if (v('Subtotal') !== '320.15' || v('GST') !== '16.01' || v('Total') !== '336.16') throw new Error(row.join(' | '));
    if (v('Received') !== '336.16' || v('Balance owing') !== '0.00') throw new Error(row.join(' | '));
    if (!/^INV-\d+$/.test(v('Invoice')) || !/^\d{4}-\d\d-\d\d$/.test(v('Invoice date'))) throw new Error(row.join(' | '));
    if (r.some(x => x[col(r,'PO')] === String(ids.oNo))) throw new Error('a job never invoiced is in it');
    if (!/^poseidon-invoices-all-to-\d{4}-\d\d-\d\d\.csv$/.test(inv.name)) throw new Error(inv.name);
    console.log('       ' + v('Invoice') + ': 320.15 + 16.01 GST = 336.16');
  });
  await t('a name that looks like a formula stays text', async () => {
    const r = inv.rows;
    const row = r.find(x => x[col(r,'PO')] === String(ids.aNo));
    if (row[col(r,'Customer')] !== "'=SUM(A1)") throw new Error(row[col(r,'Customer')]);
    if (inv.raw.charCodeAt(0) !== 0xfeff) throw new Error('no BOM — Excel would garble accents');
  });
  await t('Payments: each payment dated, and they add up to what was received', async () => {
    pay = await grab('payments');
    const r = pay.rows, mine = r.filter(x => x[col(r,'PO')] === String(ids.aNo));
    if (mine.length !== 2) throw new Error(JSON.stringify(mine));
    const sum = mine.reduce((s, x) => s + Number(x[col(r,'Amount')]), 0);
    if (Math.abs(sum - 336.16) > 0.001) throw new Error('adds to ' + sum);
    if (!mine.every(x => /^\d{4}-\d\d-\d\d$/.test(x[col(r,'Date')]))) throw new Error('undated');
    if (mine[0][col(r,'Method')] !== 'Interac e-Transfer' || mine[1][col(r,'Reference')] !== 'pi_123') throw new Error(JSON.stringify(mine));
  });
  await t('a payment recorded before payments were dated is included and says it has no date', async () => {
    const legacyNo = await pg.evaluate(id => Store.job(id).no, ids.legacy);
    const r = pay.rows, old = r.find(x => x[col(r,'PO')] === String(legacyNo));
    if (!old) throw new Error('left out of all-time');
    if (old[col(r,'Amount')] !== '40.00' || old[col(r,'Date')] !== '') throw new Error(old.join(' | '));
    if (!/date not recorded/.test(old[col(r,'Note')])) throw new Error(old.join(' | '));
  });
  await t('Receipts: each costed line, rounded like a till, GST lines flagged, uncosted left out', async () => {
    rec = await grab('receipts');
    const r = rec.rows, mine = r.filter(x => x[col(r,'PO / estimate')] === String(ids.aNo));
    if (mine.length !== 2) throw new Error(JSON.stringify(mine));
    const pex = mine.find(x => /PEX/.test(x[col(r,'Item')])), gst = mine.find(x => x[col(r,'Item')] === 'GST');
    if (pex[col(r,'Line total')] !== '3.35' || pex[col(r,'Unit cost')] !== '1.115' || pex[col(r,'Date')] !== '2026-11-10') throw new Error(pex.join(' | '));
    if (gst[col(r,'GST line?')] !== 'yes' || pex[col(r,'GST line?')] !== '') throw new Error('GST flag wrong');
  });

  console.log('--- a period ---');
  await t('a date range keeps only what falls in it, and leaves out an undated payment, saying so', async () => {
    const today = await pg.evaluate(() => todayStr());
    const p2 = await grab('payments', today, today);
    const r = p2.rows;
    if (r.some(x => x[col(r,'Note')] && /date not recorded/.test(x[col(r,'Note')]))) throw new Error('undated payment put in a dated period');
    if (r.filter(x => x[col(r,'PO')] === String(ids.aNo)).length !== 2) throw new Error('today\'s payments missing');
    const said = await pg.evaluate(() => [...document.querySelectorAll('.toast, [class*="toast"]')].map(x => x.textContent).join(' '));
    if (!/earlier payment with no date left out/.test(said)) throw new Error('did not say: ' + said);
    const r2 = (await grab('receipts', '2026-11-11', '2026-11-30')).rows;
    if (r2.length !== 1) throw new Error('receipts from Nov 10 leaked into Nov 11–30');
  });

  await b.close();
  const hard = errs.filter(e=>e.includes('CONSOLE')||e.includes('PAGEERROR'));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
