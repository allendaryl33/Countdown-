/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it if the app lives elsewhere. */
const APP = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1200,height:1000} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${APP}/index.html`); await pg.waitForTimeout(450);

  // A finished job with money on it and nothing billed — the "to send" case.
  const jid = await pg.evaluate(() => {
    const j = Store.data.jobs.find(x => x.parts && x.parts.length);
    j.status = 'complete'; j.laborHours = 2; j.laborRate = 145;
    j.payment = blankPayment(); j.invoiceNo = null; j.invoicedOn = null;
    Object.assign(Store.data.settings, { gst:'123456789 RT0001', gstRate:5, invoiceTerms:15 });
    Store.save(); return j.id;
  });
  const go = async tab => {
    await pg.evaluate(x => { App.view = 'invoices'; App.invTab = x; render(); }, tab);
    await pg.waitForTimeout(250);
  };
  const body = () => pg.evaluate(() => document.querySelector('#view').textContent.replace(/\s+/g,' ').trim());

  console.log('--- the section exists and is reachable ---');
  await t('Invoices is on the phone bottom bar, beside Estimates', async () => {
    const ph = await b.newPage({ viewport:{width:390,height:844} });
    await ph.goto(`file://${APP}/index.html`); await ph.waitForTimeout(400);
    const labels = await ph.$$eval('#mobile-nav button', bs => bs.map(x => x.textContent.trim()));
    if (!labels.some(l => /Invoices/.test(l))) throw new Error('not on the bar: ' + JSON.stringify(labels));
    // Six buttons across 390px: check none of them wrapped to two lines.
    const tall = await ph.$$eval('#mobile-nav button', bs =>
      bs.filter(x => x.getBoundingClientRect().height > 54).map(x => x.textContent.trim()));
    if (tall.length) throw new Error('labels wrapped on a phone: ' + JSON.stringify(tall));
    await ph.click('#mobile-nav button:nth-child(5)'); await ph.waitForTimeout(300);
    const title = await ph.textContent('#page-title');
    if (title.trim() !== 'Invoices') throw new Error('tapping it went to ' + title);
    await ph.close();
    console.log('       ' + labels.join(' | '));
  });

  await t('three tabs, each with a count', async () => {
    await go('out');
    const tabs = await pg.$$eval('[data-inv-tab]', bs => bs.map(x => x.textContent.trim()));
    if (tabs.length !== 3) throw new Error('tabs: ' + JSON.stringify(tabs));
    if (!tabs.every(x => /\(\d+\)$/.test(x))) throw new Error('no counts: ' + JSON.stringify(tabs));
    console.log('       ' + tabs.join('  '));
  });

  console.log('--- to send ---');
  await t('a finished job with money on it is waiting to be billed', async () => {
    await go('tosend');
    const rows = await pg.$$eval('.stop.inv-tosend .stop-body .cust', bs => bs.map(x => x.textContent.trim()));
    const who = await pg.evaluate(id => custName(Store.job(id).customerId), jid);
    if (!rows.includes(who)) throw new Error(who + ' not in the to-send list: ' + JSON.stringify(rows));
    if (!/Make the invoice/.test(await body())) throw new Error('no action on the row');
  });

  await t('a finished job with no money on it is not', async () => {
    const free = await pg.evaluate(() => {
      const j = Store.data.jobs.find(x => x.status === 'complete' && !Store.jobTotal(x) &&
        (!x.payment || x.payment.status === 'unbilled'));
      if (j) return j.id;
      const n = Store.data.jobs.find(x => !Store.jobTotal(x));
      if (!n) return null;
      n.status = 'complete'; n.payment = blankPayment(); Store.save(); return n.id;
    });
    if (!free) { console.log('       (no zero-value job to test with)'); return; }
    const inList = await pg.evaluate(id => Store.invToSend().some(j => j.id === id), free);
    if (inList) throw new Error('a no-charge job is sitting in the invoice list');
  });

  console.log('--- saving the PDF sends it ---');
  await t('printing moves it out of To send and into Out, with a reference', async () => {
    const before = await pg.evaluate(id => (Store.job(id).payment||{}).status, jid);
    if (before !== 'unbilled') throw new Error('started at ' + before);
    await pg.evaluate(id => printInvoice(id), jid).catch(()=>{});
    await pg.waitForTimeout(1800);
    const after = await pg.evaluate(id => {
      const j = Store.job(id);
      return { status:j.payment.status, ref:j.payment.ref, no:j.invoiceNo, on:j.invoicedOn,
               toSend: Store.invToSend().some(x => x.id === id),
               out: Store.outstanding().some(x => x.id === id) };
    }, jid);
    if (after.status !== 'invoiced') throw new Error('still ' + after.status);
    if (after.ref !== 'INV-' + after.no) throw new Error('reference is ' + after.ref);
    if (after.toSend) throw new Error('still showing as unbilled');
    if (!after.out) throw new Error('not in the waiting-on-money list');
    console.log('       ' + after.ref + ' sent ' + after.on);
  });

  await t('the invoice number does not move when it is printed again', async () => {
    const no = await pg.evaluate(id => Store.job(id).invoiceNo, jid);
    await pg.evaluate(id => printInvoice(id), jid).catch(()=>{});
    await pg.waitForTimeout(1500);
    const again = await pg.evaluate(id => Store.job(id).invoiceNo, jid);
    if (again !== no) throw new Error(no + ' became ' + again);
  });

  console.log('--- how long it has been out ---');
  await t('the row says how many days ago it went out', async () => {
    await pg.evaluate(id => { Store.job(id).invoicedOn = addDays(todayStr(), -6); Store.save(); }, jid);
    await go('out');
    const tx = await body();
    if (!/sent 6 days ago/.test(tx)) throw new Error('aging missing: ' + tx.slice(0,400));
    if (!/due /.test(tx)) throw new Error('no due date shown while it is still in terms');
  });

  await t('past the due date it goes red, flags the days, and counts as overdue', async () => {
    await pg.evaluate(id => { Store.job(id).invoicedOn = addDays(todayStr(), -20); Store.save(); }, jid);
    await go('out');
    const over = await pg.evaluate(id => Store.invOverdueBy(Store.job(id)), jid);
    if (over !== 5) throw new Error('20 days out on 15-day terms = ' + over + ' overdue');
    const late = await pg.$$eval('.stop.inv-late .stop-flag', bs => bs.map(x => x.textContent.trim()));
    if (!late.some(x => /5 days overdue/.test(x))) throw new Error('no overdue flag: ' + JSON.stringify(late));
    const stat = await pg.evaluate(() => Array.from(document.querySelectorAll('.stat'))
      .map(s => s.textContent.replace(/\s+/g,' ').trim()).find(x => /Overdue/.test(x)));
    if (!/past the due date/.test(stat)) throw new Error('overdue stat: ' + stat);
    console.log('       ' + stat);
  });

  await t('owed-to-you is the sum of what is actually outstanding', async () => {
    const n = await pg.evaluate(() => ({
      owed: Store.invOwed(),
      sum: Store.outstanding().reduce((s,j) => s + Store.balance(j), 0) }));
    if (Math.abs(n.owed - n.sum) > 0.005) throw new Error(JSON.stringify(n));
    const shown = await pg.evaluate(() => Array.from(document.querySelectorAll('.stat'))
      .find(s => /Owed to you/.test(s.textContent)).querySelector('.value').textContent.trim());
    if (shown !== money_(n.owed)) throw new Error(shown + ' vs ' + money_(n.owed));
    function money_(v){ return '$' + Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
    console.log('       ' + shown + ' owed');
  });

  console.log('--- the money arriving ---');
  await t('one tap marks it paid in full, tax included', async () => {
    const total = await pg.evaluate(id => Store.invoiceTotal(Store.job(id)), jid);
    await go('out');
    await pg.click(`[data-inv-got="${jid}"]`); await pg.waitForTimeout(350);
    const n = await pg.evaluate(id => {
      const j = Store.job(id);
      return { status:j.payment.status, got:j.payment.amountPaid, bal:Store.balance(j),
               out: Store.outstanding().some(x => x.id === id),
               paid: Store.invPaid().some(x => x.id === id) }; }, jid);
    if (n.status !== 'paid') throw new Error('status ' + n.status);
    if (Math.abs(n.got - total) > 0.005) throw new Error('recorded ' + n.got + ' against a total of ' + total);
    if (n.bal > 0.005) throw new Error('left a balance of ' + n.bal + ' — the GST, probably');
    if (n.out) throw new Error('still sitting in the Out list');
    if (!n.paid) throw new Error('did not land in Paid');
    console.log('       ' + total + ' in, balance ' + n.bal);
  });

  await t('it shows up under Paid with the date and the method', async () => {
    await pg.evaluate(id => { Store.setPayment(Store.job(id), { method:'Card' }); }, jid);
    await go('paid');
    const rows = await pg.$$eval('.stop.inv-paid', bs => bs.map(x => x.textContent.replace(/\s+/g,' ').trim()));
    const mine = rows.find(x => /Card/.test(x));
    if (!mine) throw new Error('no paid row with a method: ' + JSON.stringify(rows.slice(0,3)));
    if (!/paid /.test(mine)) throw new Error('no paid date: ' + mine);
  });

  await t('a part payment keeps it in Out with the balance right', async () => {
    await pg.evaluate(id => Store.setPayment(Store.job(id), { status:'invoiced', amountPaid:0 }), jid);
    const total = await pg.evaluate(id => Store.invoiceTotal(Store.job(id)), jid);
    await go('out');
    await pg.click(`[data-inv-pay="${jid}"]`); await pg.waitForTimeout(300);
    const prefill = await pg.inputValue('#ipay-amt');
    if (Math.abs(Number(prefill) - total) > 0.005) throw new Error('prefilled ' + prefill + ', balance is ' + total);
    await pg.fill('#ipay-amt', '100');
    await pg.selectOption('#ipay-method', 'Cash');
    await pg.click(`[data-ipay-save="${jid}"]`); await pg.waitForTimeout(350);
    const n = await pg.evaluate(id => {
      const j = Store.job(id);
      return { status:j.payment.status, got:j.payment.amountPaid, bal:Store.balance(j),
               method:j.payment.method, out: Store.outstanding().some(x => x.id === id) }; }, jid);
    if (n.status !== 'invoiced') throw new Error('part payment closed it: ' + n.status);
    if (Math.abs(n.got - 100) > 0.005) throw new Error('recorded ' + n.got);
    if (Math.abs(n.bal - (total - 100)) > 0.005) throw new Error('balance ' + n.bal + ' should be ' + (total-100));
    if (n.method !== 'Cash') throw new Error('method ' + n.method);
    if (!n.out) throw new Error('dropped off the Out list with money still owed');
    const flag = await (async () => { await go('out'); return body(); })();
    if (!/Part paid/.test(flag)) throw new Error('no part-paid flag on the row');
    console.log('       $100 of ' + total + ' in, ' + n.bal + ' still owed');
  });

  await t('a second part payment that covers the rest closes it', async () => {
    const bal = await pg.evaluate(id => Store.balance(Store.job(id)), jid);
    await pg.click(`[data-inv-pay="${jid}"]`); await pg.waitForTimeout(300);
    await pg.click(`[data-ipay-save="${jid}"]`); await pg.waitForTimeout(350);
    const n = await pg.evaluate(id => {
      const j = Store.job(id);
      return { status:j.payment.status, bal:Store.balance(j) }; }, jid);
    if (n.status !== 'paid') throw new Error('still ' + n.status + ' after the rest came in (' + bal + ')');
    if (n.bal > 0.005) throw new Error('balance ' + n.bal);
  });

  await t('a wrong tap can be put straight back', async () => {
    await go('paid');
    await pg.click(`[data-inv-pay="${jid}"]`); await pg.waitForTimeout(300);
    await pg.click(`[data-ipay-clear="${jid}"]`); await pg.waitForTimeout(350);
    const n = await pg.evaluate(id => {
      const j = Store.job(id);
      return { status:j.payment.status, got:j.payment.amountPaid,
               out: Store.outstanding().some(x => x.id === id) }; }, jid);
    if (n.status !== 'invoiced' || n.got !== 0) throw new Error(JSON.stringify(n));
    if (!n.out) throw new Error('not back in the Out list');
  });

  console.log('--- the badge ---');
  await t('the badge counts what needs him, not what needs the customer', async () => {
    const n = await pg.evaluate(() => {
      // Put it comfortably inside terms: sent, not late, nothing for him to do.
      const j = Store.data.jobs.find(x => x.payment && x.payment.status === 'invoiced');
      j.invoicedOn = todayStr(); Store.save();
      return { badge: Store.invNeedsYou(), toSend: Store.invToSend().length,
               out: Store.outstanding().length,
               late: Store.outstanding().filter(x => Store.invOverdueBy(x) > 0).length };
    });
    if (n.badge !== n.toSend + n.late) throw new Error(JSON.stringify(n));
    if (n.out <= n.late && n.out > 0) console.log('       (all outstanding happen to be late)');
    console.log('       badge ' + n.badge + ' = ' + n.toSend + ' to send + ' + n.late + ' overdue, of ' + n.out + ' out');
  });

  await t('tapping a row opens the job it came from', async () => {
    await go('out');
    await pg.click('.stop .stop-main'); await pg.waitForTimeout(400);
    const open = await pg.evaluate(() => {
      const h = document.querySelector('#modal-root .modal-head');
      return h ? h.textContent.replace(/\s+/g,' ').trim() : ''; });
    if (!/#\d/.test(open)) throw new Error('no job opened: ' + open);
    await pg.evaluate(() => closeModal());
    console.log('       ' + open.slice(0,70));
  });

  await t('it survives a reload, because it is all in the saved shop', async () => {
    const before = await pg.evaluate(() => ({ owed: Store.invOwed(), out: Store.outstanding().length }));
    await pg.reload(); await pg.waitForTimeout(500);
    const after = await pg.evaluate(() => ({ owed: Store.invOwed(), out: Store.outstanding().length }));
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error(JSON.stringify(before) + ' became ' + JSON.stringify(after));
  });

  await t('the dashboard money rows land on the right tab here, not a filtered job list', async () => {
    for (const [sel, want] of [['[data-inv-go="tosend"]','tosend'], ['[data-inv-go="out"]','out']]){
      await pg.evaluate(() => { App.view='dashboard'; App.search=''; render(); });
      await pg.waitForTimeout(300);
      const there = await pg.$(sel);
      if (!there) throw new Error('no ' + sel + ' on the dashboard');
      await pg.click(sel); await pg.waitForTimeout(350);
      const at = await pg.evaluate(() => ({ view: App.view, tab: App.invTab }));
      if (at.view !== 'invoices' || at.tab !== want) throw new Error(sel + ' went to ' + JSON.stringify(at));
    }
    console.log('       both rows open Invoices on the tab they describe');
  });

  await t('it opens on a list that has something on it', async () => {
    await pg.evaluate(() => {
      // Everything settled except one finished job waiting to be billed.
      Store.data.jobs.forEach(j => { if (j.payment && j.payment.status === 'invoiced')
        Store.setPayment(j, { status:'paid' }); });
      const j = Store.data.jobs[1];
      if (!(j.parts && j.parts.length)) j.parts = [{ id:'pz', name:'Parts', qty:1, price:90 }];
      j.status='complete'; j.payment = blankPayment(); j.invoiceNo=null; j.invoicedOn=null;
      Store.save(); App.invTab = null; App.view='invoices'; render();
    });
    await pg.waitForTimeout(300);
    const on = await pg.evaluate(() => (document.querySelector('[data-inv-tab].primary')||{}).textContent);
    if (!/To send/.test(on || '')) throw new Error('opened on ' + on + ' with nothing out and work to bill');
    const rows = await pg.$$eval('.stop', bs => bs.length);
    if (!rows) throw new Error('opened on an empty list anyway');
    // Once he picks one, it stays picked.
    await pg.click('[data-inv-tab="paid"]'); await pg.waitForTimeout(250);
    await pg.evaluate(() => { App.view='today'; render(); App.view='invoices'; render(); });
    await pg.waitForTimeout(250);
    const still = await pg.evaluate(() => (document.querySelector('[data-inv-tab].primary')||{}).textContent);
    if (!/Paid/.test(still || '')) throw new Error('his choice did not stick: ' + still);
    console.log('       opened on ' + on.trim() + ', then stayed where he put it');
  });

  console.log('--- on a phone ---');
  await t('nothing on the row clips its own label, and the page does not go sideways', async () => {
    const ph = await b.newPage({ viewport:{width:390,height:844} });
    ph.on('pageerror',e=>errs.push('PHONE PAGEERROR: '+e.message));
    await ph.goto(`file://${APP}/index.html`); await ph.waitForTimeout(400);
    await ph.evaluate(() => {
      const j = Store.data.jobs[0];
      if (!(j.parts && j.parts.length)) j.parts = [{ id:'px', name:'Parts', qty:1, price:118 }];
      j.status='complete'; j.laborHours=2; j.laborRate=145;
      Store.invoiceNoFor(j); j.invoicedOn = addDays(todayStr(), -23);
      j.payment = Object.assign(blankPayment(), { status:'invoiced', amountPaid:50,
        ref:'INV-'+j.invoiceNo, invoicedAt:Date.now() });
      Store.save(); App.view='invoices'; App.invTab='out'; render();
    });
    await ph.waitForTimeout(350);
    const clipped = await ph.$$eval('.stop .stop-acts .btn', bs => bs
      .filter(x => x.scrollWidth > x.clientWidth + 1)
      .map(x => x.textContent.trim() + ' (' + x.clientWidth + ' of ' + x.scrollWidth + ')'));
    if (clipped.length) throw new Error('clipped: ' + JSON.stringify(clipped));
    const over = await ph.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 0) throw new Error('page scrolls sideways by ' + over + 'px');
    // The sheet he taps through has to fit too.
    await ph.click('.stop [data-inv-pay]'); await ph.waitForTimeout(350);
    const amt = await ph.inputValue('#ipay-amt');
    if (!Number(amt)) throw new Error('payment sheet opened with no amount: ' + amt);
    const btns = await ph.$$eval('.modal-foot .btn', bs => bs
      .filter(x => x.scrollWidth > x.clientWidth + 1).map(x => x.textContent.trim()));
    if (btns.length) throw new Error('sheet buttons clipped: ' + JSON.stringify(btns));
    await ph.close();
    console.log('       buttons intact, nothing sideways, sheet prefilled with ' + amt);
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
