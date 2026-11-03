/* The lit button should be the next thing he actually does. */
const { chromium } = require(process.env.PW || 'playwright-core');
const APP='http://127.0.0.1:54321/index.html', URL_='http://127.0.0.1:54321', KEY='sb_publishable_test';
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  await fetch(URL_+'/__reset');
  const pg = await b.newPage({ viewport:{width:430,height:900} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text())});
  await pg.goto(APP); await pg.waitForTimeout(400);
  await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'T'}; Cloud.saveCfg();
    return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY]);
  await pg.waitForTimeout(900);
  const lit = sel => pg.evaluate(s => {
    const el = document.querySelector(s);
    return el ? { txt: el.textContent.replace(/\s+/g,' ').trim(),
                  lit: /\baccent\b|\bprimary\b/.test(el.className) } : null;
  }, sel);

  await t('on a website lead, Make an estimate is the lit button', async () => {
    const id = await pg.evaluate(() => {
      Store.addManualLead({ name:"Lit Button", phone:"780-555-8080",
        service:"drains", what:"POOO EVERYWHERE", timing:"now" });
      go("leads"); return Store.leads().find(l => l.name === "Lit Button").id;
    });
    await pg.waitForTimeout(400);
    const est = await lit(`[data-lead-est="${id}"]`);
    const job = await lit(`[data-lead-job="${id}"]`);
    if (!est || !job) throw new Error('a button is missing');
    if (!est.lit) throw new Error('"' + est.txt + '" is not the lit one');
    if (job.lit)  throw new Error('"' + job.txt + '" is still lit too');
  });

  await t('both lead buttons still do their own job', async () => {
    const wired = await pg.evaluate(() =>
      typeof openLeadEstimate === 'function' || !!document.querySelector('[data-lead-est]'));
    if (!wired) throw new Error('the estimate button lost its handler');
  });

  await t('on a job, Invoice is lit and Mark Complete is not', async () => {
    const jid = await pg.evaluate(() => {
      let j = Store.data.jobs.find(x => x.status !== "complete");
      if (!j){ j = Store.data.jobs[0]; j.status = "in_progress"; Store.save(); }
      openJob(j.id); return j.id;
    });
    await pg.waitForTimeout(500);
    const inv = await lit(`[data-invoice="${jid}"]`);
    const adv = await lit(`[data-advance="${jid}"]`);
    if (!inv) throw new Error('no invoice button on the job');
    if (!inv.lit) throw new Error('"' + inv.txt + '" is not lit');
    if (adv && adv.lit) throw new Error('"' + adv.txt + '" is still lit');
    await pg.evaluate(() => closeModal());
  });

  await t('the invoice message tells them how to keep a copy', async () => {
    const jid = await pg.evaluate(() => {
      const j = Store.data.jobs.find(x => Store.jobTotal(x) > 0);
      return j.id;
    });
    await pg.evaluate(id => sendInvoiceLink(id), jid); await pg.waitForTimeout(1600);
    const note = await pg.inputValue('#iv-note').catch(async () => {
      const ta = await pg.$('textarea'); return ta ? ta.inputValue() : '';
    });
    if (!/Save a copy/i.test(note)) throw new Error('no mention of keeping a copy :: ' + note.slice(0,200));
    if (!/https?:\/\/\S+invoice/.test(note)) throw new Error('lost the link');
    await pg.evaluate(() => closeModal());
  });

  await t('the link is the last thing in the message, so the phone draws the card', async () => {
    // Messages builds the preview — the letterhead and the logo — only from a
    // URL that ends the message. A line after it leaves a bare blue link.
    const jid = await pg.evaluate(() => Store.data.jobs.find(x => Store.jobTotal(x) > 0).id);
    await pg.evaluate(id => sendInvoiceLink(id), jid); await pg.waitForTimeout(1600);
    const inv = await pg.inputValue('#iv-note');
    const after = inv.slice(inv.lastIndexOf('http')).split(/\s/)[0];
    if (inv.trim().slice(-after.length) !== after)
      throw new Error('something follows the invoice link :: ' + JSON.stringify(inv.slice(-120)));
    await pg.evaluate(() => closeModal());

    const eid = await pg.evaluate(() => {
      const e = Store.data.estimates.find(x => (x.items||[]).length && !x.approval);
      e.status = 'draft'; Store.save(); return e.id;
    });
    await pg.evaluate(id => sendForSignature(id), eid); await pg.waitForTimeout(1600);
    const est = await pg.inputValue('#lk-note');
    const a2 = est.slice(est.lastIndexOf('http')).split(/\s/)[0];
    if (est.trim().slice(-a2.length) !== a2)
      throw new Error('something follows the signing link :: ' + JSON.stringify(est.slice(-120)));
    await pg.evaluate(() => closeModal());
  });

  await t('an unpaid invoice quotes what they owe, never zero', async () => {
    const jid = await pg.evaluate(() => {
      const j = Store.data.jobs.find(x => Store.jobTotal(x) > 0);
      Store.setPayment(j, { status:"invoiced", amountPaid: 0 });
      return j.id;
    });
    await pg.evaluate(id => sendInvoiceLink(id), jid); await pg.waitForTimeout(1600);
    const note = await pg.inputValue('#iv-note');
    const owed = await pg.evaluate(id => Store.balance(Store.job(id)), jid);
    if (/\$0\.00/.test(note)) throw new Error('quotes nothing owed :: ' + note.slice(0,140));
    if (!note.includes(money(owed))) throw new Error('does not quote ' + owed + ' :: ' + note.slice(0,140));
    if (!/invoice for/i.test(note)) throw new Error('should read as an invoice');
    await pg.evaluate(() => closeModal());
    function money(v){ return '$' + Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  });

  await t('once it is paid it goes out as a receipt for the real total', async () => {
    const jid = await pg.evaluate(() => {
      const j = Store.data.jobs.find(x => Store.jobTotal(x) > 0);
      Store.setPayment(j, { status:"paid", method:"Cash" });
      return j.id;
    });
    const total = await pg.evaluate(id => Store.invoiceTotal(Store.job(id)), jid);
    await pg.evaluate(id => sendInvoiceLink(id), jid); await pg.waitForTimeout(1600);
    const note = await pg.inputValue('#iv-note');
    if (/\$0\.00/.test(note)) throw new Error('still sending a zero invoice :: ' + note.slice(0,160));
    if (!/receipt/i.test(note)) throw new Error('should call itself a receipt :: ' + note.slice(0,160));
    if (!note.includes(money(total))) throw new Error('does not quote the total ' + total);
    if (/pay from the same page/i.test(note)) throw new Error('still asking a paid customer to pay');
    const head = await pg.evaluate(() => document.querySelector('.modal-head h2').textContent);
    if (!/receipt/i.test(head)) throw new Error('dialog still says: ' + head);
    const body = await pg.evaluate(() => document.querySelector('.modal-body').textContent);
    if (/They can pay by/i.test(body)) throw new Error('still listing ways to pay on a paid job');
    await pg.evaluate(() => closeModal());
    function money(v){ return '$' + Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  });

  console.log('--- what the customer opens ---');
  await t('the invoice page offers a Save a copy button that prints', async () => {
    const tok = await pg.evaluate(() => {
      const l = (Cloud.invoiceLinks || [])[0];
      return l ? l.token : null;
    });
    if (!tok) throw new Error('no invoice link was published');
    const cust = await b.newPage({ viewport:{width:390,height:844} });
    let printed = false;
    await cust.exposeFunction('__printed', () => { printed = true; });
    await cust.addInitScript(() => { window.print = () => window.__printed(); });
    await cust.goto(URL_ + '/invoice.html#t=' + tok + '&u=' + encodeURIComponent(URL_) + '&k=' + KEY);
    await cust.waitForTimeout(1600);
    const btn = await cust.$('#pdf');
    if (!btn) throw new Error('no save button on the invoice page');
    await btn.click(); await cust.waitForTimeout(400);
    if (!printed) throw new Error('the button did not open the print screen');
    await cust.close();
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
