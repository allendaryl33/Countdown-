/* One customer, start to finish, the way Daryl would actually do it.
   Every step asserts what he should be seeing on the screen at that moment. */
const { chromium } = require(process.env.PW || 'playwright-core');
const APP='http://127.0.0.1:54321/index.html', URL_='http://127.0.0.1:54321', KEY='sb_publishable_test';
const errs=[]; let step=0;
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{step++;try{await fn();console.log('  '+step+'. '+n);}catch(e){console.log('  '+step+'. FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  await fetch(URL_+'/__reset');
  const pg = await b.newPage({ viewport:{width:430,height:900} });   // his phone
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text())});
  await pg.goto(APP); await pg.waitForTimeout(400);
  await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'Phone'}; Cloud.saveCfg();
    return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY]);
  await pg.waitForTimeout(900);
  await pg.evaluate(() => { Object.assign(Store.data.settings,
    { gst:'123456789 RT0001', gstRate:5, company:'Poseidon Plumbing & Gasfitting Ltd.' }); Store.save(); });

  const text = () => pg.evaluate(() => document.body.textContent.replace(/\s+/g,' '));
  let estId, jobId, token;

  await t('a lead comes in off the website and shows in Leads', async () => {
    await pg.evaluate(() => {
      Store.addManualLead({ name:"Walk Through", phone:"780-555-9001",
        email:"walk@example.com", address:"77 Finish Line",
        service:"Water heater", what:"No hot water since Tuesday.", timing:"anytime" });
      go("leads");
    });
    await pg.waitForTimeout(400);
    if (!/Walk Through/.test(await text())) throw new Error('the lead is not on the Leads screen');
  });

  await t('he builds an estimate off it, with GST on top', async () => {
    estId = await pg.evaluate(() => {
      const l = Store.leads().find(x => x.name === "Walk Through");
      const e = { id: uid("est"), no: Store.nextEstNo(), createdAt: Date.now(),
        type:"Water Heater", description:l.what, status:"draft",
        items:[{ desc:"Supply and install 50 gal tank", qty:1, price:2400, kind:"Labor" }],
        materials:[], customerId:null, log:[],
        lead:{ name:l.name, phone:l.phone, email:l.email, address:l.address, city:"Edmonton" } };
      Store.data.estimates.push(e); Store.save(); return e.id;
    });
    const n = await pg.evaluate(i => { const e = Store.estimate(i);
      return { sub:Store.estimateTotal(e), tax:Store.estimateTax(e), gross:Store.estimateGross(e) }; }, estId);
    if (n.sub !== 2400) throw new Error('subtotal ' + n.sub);
    if (n.tax !== 120) throw new Error('GST should be 120, got ' + n.tax);
    if (n.gross !== 2520) throw new Error('total should be 2520, got ' + n.gross);
  });

  await t('he taps Send — the message carries the signing link and the real total', async () => {
    await pg.evaluate(i => sendForSignature(i), estId); await pg.waitForTimeout(1400);
    const note = await pg.inputValue('#lk-note');
    const m = note.match(/https?:\/\/\S+/);
    if (!m) throw new Error('no link in the message');
    token = m[0].match(/t=([0-9a-f]+)/)[1];
    if (!/2,520|2520/.test(note)) throw new Error('message does not quote the with-GST total: ' + note);
  });

  await t('until he taps, nothing claims it was sent', async () => {
    const s = await pg.evaluate(i => Store.estimate(i).status, estId);
    if (s !== 'draft') throw new Error('already marked ' + s);
  });

  await t('he taps Text — now it is sent, and the record says so', async () => {
    await pg.click('[data-copy-link][data-sent-id]'); await pg.waitForTimeout(400);
    // Copying is not sending either: the panel asks before anything is
    // written down, so the send is the answer, not the tap.
    await pg.click('[data-link-went="yes"]'); await pg.waitForTimeout(400);
    const s = await pg.evaluate(i => Store.estimate(i).status, estId);
    if (s !== 'sent') throw new Error('status ' + s);
    await pg.evaluate(() => closeModal());
    await pg.evaluate(i => openEstimate(i), estId); await pg.waitForTimeout(500);
    if (!/Out for signature/.test(await text())) throw new Error('record does not say it is out');
    await pg.evaluate(() => closeModal());
  });

  await t('the customer opens the link on their phone and sees the quote', async () => {
    const cust = await b.newPage({ viewport:{width:390,height:844} });
    const url = URL_ + '/sign.html#t=' + token + '&u=' + encodeURIComponent(URL_) + '&k=' + KEY;
    await cust.goto(url); await cust.waitForTimeout(1500);
    const tx = await cust.evaluate(() => document.body.textContent.replace(/\s+/g,' '));
    if (!/50 gal tank/.test(tx)) throw new Error('the work is not on the page');
    if (!/GST/.test(tx)) throw new Error('no GST shown to the customer');
    if (!/2,520/.test(tx)) throw new Error('not showing what they actually owe: ' + tx.slice(0,200));
    if (/price book|Price Book/.test(tx)) throw new Error('the price book leaked to the customer');
    global.__cust = cust;
  });

  await t('they sign it with a finger and it goes back to the database', async () => {
    const cust = global.__cust;
    await cust.fill('#nm', 'Walk Through');
    const pad = cust.locator('#pad');
    await pad.scrollIntoViewIfNeeded(); await cust.waitForTimeout(300);
    const bx = await pad.boundingBox(), y0 = bx.y + bx.height/2;
    await cust.mouse.move(bx.x+25, y0); await cust.mouse.down();
    for (const d of [[40,-18],[90,14],[140,-12],[180,8]]) await cust.mouse.move(bx.x+25+d[0], y0+d[1]);
    await cust.mouse.up(); await cust.waitForTimeout(300);
    await cust.click('#go'); await cust.waitForTimeout(1800);
    const tx = await cust.evaluate(() => document.body.textContent.replace(/\s+/g,' '));
    if (!/approved|Thank|signed/i.test(tx)) throw new Error('no confirmation: ' + tx.slice(0,200));
  });

  await t('his phone picks it up and the estimate flips to Approved', async () => {
    await pg.evaluate(() => Cloud.pullSignLinks()); await pg.waitForTimeout(1200);
    const r = await pg.evaluate(i => { const e = Store.estimate(i);
      return { status:e.status, who: e.approval ? e.approval.name : null, jobId: e.jobId||null }; }, estId);
    if (r.status !== 'approved') throw new Error('still ' + r.status);
    if (r.who !== 'Walk Through') throw new Error('signer is ' + r.who);
    if (!r.jobId) throw new Error('no job was made');
    jobId = r.jobId;
  });

  await t('the job is sitting in Schedule with no date, waiting for him', async () => {
    const j = await pg.evaluate(i => { const x = Store.job(i);
      return { date:x.scheduledDate, tech:x.techId, cust:Store.customer(x.customerId).name, quoted:x.quotedTotal }; }, jobId);
    if (j.date) throw new Error('it picked a date: ' + j.date);
    if (j.cust !== 'Walk Through') throw new Error('job is on ' + j.cust);
    if (j.quoted !== 2400) throw new Error('quoted total is ' + j.quoted);
    await pg.evaluate(() => go("schedule")); await pg.waitForTimeout(500);
    const inStrip = await pg.evaluate(i => !!document.querySelector('.tray-strip [data-job="'+i+'"]'), jobId);
    if (!inStrip) throw new Error('not in the unassigned strip');
  });

  await t('he drops it on a day and gives it to a tech', async () => {
    await pg.evaluate(i => { const j = Store.job(i);
      j.scheduledDate = todayStr(); j.status = "scheduled";
      Store.assign(j, Store.data.techs[0].id); Store.save(); }, jobId);
    const j = await pg.evaluate(i => { const x = Store.job(i);
      return { date:x.scheduledDate, tech: x.techId ? Store.tech(x.techId).name : null, status:x.status }; }, jobId);
    if (!j.date || !j.tech) throw new Error(JSON.stringify(j));
    await pg.evaluate(() => { go("schedule"); render(); }); await pg.waitForTimeout(400);
    const stillLoose = await pg.evaluate(i => !!document.querySelector('.tray-strip [data-job="'+i+'"]'), jobId);
    if (stillLoose) throw new Error('it is still in the unassigned strip after being scheduled');
  });

  await t('the work gets done and the job is marked complete', async () => {
    await pg.evaluate(i => { const j = Store.job(i);
      Store.setJobStatus ? Store.setJobStatus(j,"complete") : (j.status="complete", j.completedAt=Date.now());
      Store.save(); }, jobId);
    const s = await pg.evaluate(i => Store.job(i).status, jobId);
    if (s !== 'complete') throw new Error('status ' + s);
  });

  await t('it becomes an invoice for the right money — work plus GST', async () => {
    const m = await pg.evaluate(i => { const j = Store.job(i);
      return { work: Store.jobTotal(j), tax: Store.taxOn(j), owed: Store.invoiceTotal(j) }; }, jobId);
    if (m.work !== 2400) throw new Error('work total ' + m.work);
    if (m.tax !== 120) throw new Error('GST ' + m.tax);
    if (m.owed !== 2520) throw new Error('owed ' + m.owed);
    await pg.evaluate(i => Store.setPayment(Store.job(i), { status:"invoiced" }), jobId);
    await pg.evaluate(() => go("invoices")); await pg.waitForTimeout(500);
    if (!/Walk Through/.test(await text())) throw new Error('not on the Invoices screen');
  });

  await t('the estimate steps out of Approved and into All', async () => {
    const r = await pg.evaluate(i => {
      go("estimates"); App.estFilter = "approved"; render();
      const inApproved = !!document.querySelector('[data-estimate="'+i+'"]');
      App.estFilter = "all"; render();
      return { inApproved, inAll: !!document.querySelector('[data-estimate="'+i+'"]') };
    }, estId);
    await pg.waitForTimeout(300);
    if (r.inApproved) throw new Error('still cluttering Approved');
    if (!r.inAll) throw new Error('it fell out of All too');
  });

  await t('money lands, paid in full means the GST too, balance is zero', async () => {
    await pg.evaluate(i => Store.setPayment(Store.job(i), { status:"paid", method:"Card" }), jobId);
    const r = await pg.evaluate(i => { const j = Store.job(i);
      return { paid: j.payment.amountPaid, bal: Store.balance(j), status: j.payment.status }; }, jobId);
    if (r.paid !== 2520) throw new Error('recorded ' + r.paid + ' as paid in full, should be 2520');
    if (r.bal !== 0) throw new Error('balance left over: ' + r.bal);
  });

  await t('and it all survives closing the app', async () => {
    await pg.reload(); await pg.waitForTimeout(700);
    const r = await pg.evaluate(([e,j]) => ({
      est: Store.estimate(e).status, signed: !!Store.estimate(e).approval,
      pay: Store.job(j).payment.status, owed: Store.balance(Store.job(j)) }), [estId, jobId]);
    if (r.est !== 'approved' || !r.signed) throw new Error('estimate lost: ' + JSON.stringify(r));
    if (r.pay !== 'paid' || r.owed !== 0) throw new Error('payment lost: ' + JSON.stringify(r));
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' broke the flow'); process.exit(1); }
  console.log('\nthe whole flow holds, start to finish');
})();
