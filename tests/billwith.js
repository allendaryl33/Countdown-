/* Change of scope: work he agrees to after the fact is its own job — its own
   signed estimate, its own slot on the calendar, its own photos — but it is
   not its own invoice. The customer agreed to one bathroom and gets one bill.

   The trap here is Time & Money. jobTotal is what he earned and has to stay
   per-job, because rolling a child into its parent would count the same work
   twice in the one place he looks to see what the month made. Only the
   invoice adds them up. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:430,height:950} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  /* A flat bathroom at 8500 and an added valve job at 500, same customer. */
  const ids = await pg.evaluate(() => {
    Store.data.settings.gst = ""; 
    const p = Store.data.jobs[0];
    Object.assign(p, { flatPrice: 8500, laborHours: 0, status: "complete",
      payment: null, billWith: null,
      parts: [ { desc:"Demo and haul away", qty:1, price:0 },
               { desc:"Rough-in the valve", qty:1, price:0 } ] });
    const c = {
      id: "job_kid_1", no: 9001, customerId: p.customerId,
      type: "Other", service: "move the shutoff", description: "",
      status: "complete", scheduledDate: p.scheduledDate, payment: null,
      billWith: null, flatPrice: null, laborHours: 2, laborRate: 150,
      parts: [ { desc:"Quarter-turn stop", qty:2, price:25 } ], log: [], photos: []
    };
    Store.data.jobs.push(c); Store.save();
    return { p: p.id, c: c.id };
  });
  const ev = fn => pg.evaluate(fn, ids);
  const money = () => ev(i => {
    const p = Store.job(i.p), c = Store.job(i.c);
    return { pEarned: Store.jobTotal(p), cEarned: Store.jobTotal(c),
             pBilled: Store.billedTotal(p), pInv: Store.invoiceTotal(p),
             lines: Store.invoiceLines(p) };
  });

  await t('two separate jobs bill separately until he says otherwise', async () => {
    const r = await money();
    if (r.pInv !== 8500) throw new Error('parent invoice is ' + r.pInv + ', wanted 8500');
    const both = await ev(i => Store.invToSend().map(j => j.id));
    if (!both.includes(ids.p) || !both.includes(ids.c))
      throw new Error('both should be waiting to be invoiced: ' + JSON.stringify(both));
  });

  await t('attaching one to the other is allowed and says nothing is wrong', async () => {
    const why = await ev(i => Store.billTogether(Store.job(i.c), Store.job(i.p)));
    if (why) throw new Error('refused: ' + why);
  });

  await t('the added work no longer asks to be invoiced on its own', async () => {
    const list = await ev(i => Store.invToSend().map(j => j.id));
    if (list.includes(ids.c)) throw new Error('the added job is still in the invoice list');
    if (!list.includes(ids.p)) throw new Error('the main job fell out of the invoice list');
    const tb = await ev(i => Store.toInvoice().map(j => j.id));
    if (tb.includes(ids.c)) throw new Error('still showing under work to bill');
  });

  await t('what he earned is unchanged on both — Time & Money must not double up', async () => {
    const r = await money();
    if (r.pEarned !== 8500) throw new Error('parent earned reads ' + r.pEarned);
    if (r.cEarned !== 350)  throw new Error('added job earned reads ' + r.cEarned);
  });

  await t('one bill, and it is the two of them added together', async () => {
    const r = await money();
    if (r.pBilled !== 8850) throw new Error('billed total is ' + r.pBilled + ', wanted 8850');
    if (r.pInv !== 8850) throw new Error('invoice total is ' + r.pInv);
  });

  await t('the invoice lines add up to what it asks for', async () => {
    const r = await money();
    const sum = r.lines.reduce((s,x) => s + x.qty * x.price, 0);
    if (sum !== 8850) throw new Error('lines add to ' + sum + ' but the invoice says 8850: '
      + JSON.stringify(r.lines));
  });

  await t('the agreed price comes out as its own line once something costs money', async () => {
    const r = await money();
    const a = r.lines.find(x => x.desc === "Agreed price");
    if (!a) throw new Error('no agreed-price line, so the scope reads as free: ' + JSON.stringify(r.lines));
    if (a.qty * a.price !== 8500) throw new Error('agreed line is ' + JSON.stringify(a));
  });

  await t('the customer can see which part is the added work', async () => {
    const r = await money();
    const h = r.lines.find(x => x.scope && /^Added: /.test(x.desc));
    if (!h) throw new Error('nothing marks where the extra starts: ' + JSON.stringify(r.lines));
    if (!/move the shutoff/i.test(h.desc))
      throw new Error('the heading does not use her own words: ' + h.desc);
    if (!r.lines.some(x => x.desc === "Quarter-turn stop" && x.price === 25))
      throw new Error('the added parts are not itemised');
    if (!r.lines.some(x => x.desc === "Labour" && x.qty === 2))
      throw new Error('the added labour is not itemised');
  });

  await t('GST is charged on the whole bill, not just the first job', async () => {
    const r = await ev(i => {
      Store.data.settings.gst = "1"; Store.data.settings.gstRate = 5; Store.save();
      const p = Store.job(i.p);
      return { tax: Store.taxOn(p), total: Store.invoiceTotal(p) };
    });
    if (r.tax !== 442.5) throw new Error('GST is ' + r.tax + ', wanted 442.50 on 8850');
    if (r.total !== 9292.5) throw new Error('total is ' + r.total);
    await ev(() => { Store.data.settings.gst = ""; Store.save(); });
  });

  await t('what is still owed follows the combined bill', async () => {
    const bal = await ev(i => {
      const p = Store.job(i.p);
      p.payment = Object.assign(blankPayment(), { status:"invoiced", amountPaid: 1000 });
      Store.save(); return Store.balance(p);
    });
    if (bal !== 7850) throw new Error('balance is ' + bal + ', wanted 7850');
  });

  await t('the added job is not counted again as outstanding', async () => {
    const out = await ev(i => Store.outstanding().map(j => j.id));
    if (out.includes(ids.c)) throw new Error('the added job shows as its own outstanding invoice');
    if (!out.includes(ids.p)) throw new Error('the main invoice is missing from outstanding');
  });

  await t('nor again as paid, which would overstate what came in', async () => {
    const paid = await ev(i => {
      const p = Store.job(i.p), c = Store.job(i.c);
      p.payment.status = "paid";
      c.payment = Object.assign(blankPayment(), { status:"paid" });
      Store.save(); return Store.invPaid().map(j => j.id);
    });
    if (paid.includes(ids.c)) throw new Error('the added job counts as a second payment');
  });

  await t('it will not attach to an invoice that has already gone out', async () => {
    const why = await ev(i => {
      const p = Store.job(i.p), c = Store.job(i.c);
      Store.billSeparately(c);
      p.payment = Object.assign(blankPayment(), { status:"invoiced" }); Store.save();
      return Store.canBillTogether(c, p);
    });
    if (!why) throw new Error('it let him add work to an invoice the customer already has');
    if (!/already gone out/i.test(why)) throw new Error('unhelpful refusal: ' + why);
  });

  await t('nor pull in work that has already been invoiced on its own', async () => {
    const why = await ev(i => {
      const p = Store.job(i.p), c = Store.job(i.c);
      p.payment = null;
      c.payment = Object.assign(blankPayment(), { status:"invoiced" }); Store.save();
      return Store.canBillTogether(c, p);
    });
    if (!why || !/invoiced on its own/i.test(why)) throw new Error('refusal was: ' + why);
  });

  await t('nor two different customers, which would bill the wrong person', async () => {
    const why = await ev(i => {
      const p = Store.job(i.p), c = Store.job(i.c);
      c.payment = null; const keep = c.customerId; c.customerId = "someone_else";
      const r = Store.canBillTogether(c, p); c.customerId = keep; Store.save(); return r;
    });
    if (!why || !/different customers/i.test(why)) throw new Error('refusal was: ' + why);
  });

  await t('nor onto itself, and nor in a loop', async () => {
    const r = await ev(i => {
      const p = Store.job(i.p), c = Store.job(i.c);
      const self = Store.canBillTogether(p, p);
      Store.billTogether(c, p);
      const loop = Store.canBillTogether(p, c);
      return { self, loop };
    });
    if (!r.self) throw new Error('a job was allowed to bill with itself');
    if (!r.loop) throw new Error('a loop was allowed');
  });

  await t('taking it apart again gives the added work its own invoice back', async () => {
    const r = await ev(i => {
      Store.billSeparately(Store.job(i.c));
      const p = Store.job(i.p);
      return { billed: Store.billedTotal(p), list: Store.invToSend().map(j => j.id) };
    });
    if (r.billed !== 8500) throw new Error('the main job still bills ' + r.billed);
    if (!r.list.includes(ids.c)) throw new Error('the added job did not come back into the list');
  });

  await t('a cancelled add-on stops being billed without being unlinked', async () => {
    const billed = await ev(i => {
      const c = Store.job(i.c);
      Store.billTogether(c, Store.job(i.p));
      c.status = "cancelled"; Store.save();
      return Store.billedTotal(Store.job(i.p));
    });
    if (billed !== 8500) throw new Error('a cancelled add-on is still on the bill at ' + billed);
  });

  await t('both jobs keep a record of what he did, in their own log', async () => {
    const r = await ev(i => ({
      p: (Store.job(i.p).log || []).map(l => l.text || l).join(' | '),
      c: (Store.job(i.c).log || []).map(l => l.text || l).join(' | ')
    }));
    if (!/Billing with it/i.test(r.p)) throw new Error('the main job says nothing: ' + r.p);
    if (!/Billed with job #/i.test(r.c)) throw new Error('the added job says nothing: ' + r.c);
  });

  /* The printed copy and the one she opens by link are the same bill, so
     they have to say the same thing. The printed one used to build its own
     lines off j.parts while taking its tax and total from the Store. */
  await t('the printed invoice shows the added work it is charging for', async () => {
    const h = await ev(async i => {
      const p = Store.job(i.p), c = Store.job(i.c);
      p.payment = null; c.payment = null;
      c.status = "complete";            // the cancelled test above left it off
      const why = Store.billTogether(c, p);
      if (why) throw new Error(why);
      p.invoicedOn = todayStr();
      Store.save();
      return await invoiceDocHtml(p);
    });
    if (!/Quarter-turn stop/.test(h))
      throw new Error('the added parts are not on the printed invoice');
    if (!/Agreed price/.test(h))
      throw new Error('the flat price is not shown, so the lines read as free');
    if (!/Added: /.test(h))
      throw new Error('nothing marks the added work on the printed invoice');
  });

  await t('and its subtotal is the whole bill, not just the first job', async () => {
    const h = await ev(async i => await invoiceDocHtml(Store.job(i.p)));
    // The Total row already read 8850 before this was fixed, because it comes
    // from the Store. It was the Subtotal, built here, that said 8500.
    const foot = (h.split('<tfoot>')[1] || "").replace(/<[^>]+>/g, '|');
    const sub = (foot.match(/Subtotal\|+\$([\d,]+\.\d\d)/) || [])[1];
    if (!sub) throw new Error('no subtotal row on the printed invoice: ' + foot.slice(0,200));
    if (sub !== '8,850.00')
      throw new Error('the printed subtotal is $' + sub + ' against a total of $8,850.00');
  });

  /* On a flat job with nothing added, the scope is listed and the agreed
     price is the only figure. The printed copy used to put $0.00 in the qty,
     price and amount columns of every scope line and then a subtotal of
     8500 underneath, which reads to a customer like a mistake. */
  await t('a flat job with nothing added prices the scope at nothing, not $0.00', async () => {
    const h = await ev(async i => {
      Store.billSeparately(Store.job(i.c));
      Store.save();
      return await invoiceDocHtml(Store.job(i.p));
    });
    const body = h.split('<tfoot>')[0];
    if (/\$0\.00/.test(body))
      throw new Error('the scope lines are printed at $0.00 each against a subtotal');
    if (!/Demo and haul away/.test(body))
      throw new Error('the scope is not listed at all');
    const foot = h.split('<tfoot>')[1] || "";
    if (!/8,500\.00/.test(foot))
      throw new Error('the agreed price is not the total: ' + foot.replace(/<[^>]+>/g,' ').slice(0,200));
  });

  await t('a job he never named prints her own words, never "Other"', async () => {
    const h = await ev(async i => {
      const p = Store.job(i.p);
      const keep = { t: p.type, s: p.service };
      p.type = "Other"; p.service = "shower rebuild"; Store.save();
      const doc = await invoiceDocHtml(p);
      p.type = keep.t; p.service = keep.s; Store.save();
      return doc;
    });
    const head = (h.match(/Work done<\/strong><br>\s*([^&]*)/) || [])[1] || "";
    if (/Other/i.test(head)) throw new Error('the printed invoice says "Other" to the customer');
    if (!/shower rebuild/i.test(head)) throw new Error('it does not use her own words: ' + head);
  });

  await b.close();
  if (errs.length){
    // Naming them matters: a console or page error is a failure too, and it
    // is recorded by the listeners above without ever printing a FAIL line.
    console.log('\n' + errs.length + ' problem(s)');
    errs.forEach(e => console.log('  - ' + e));
    process.exit(1);
  }
  console.log('\nall good');
})();
