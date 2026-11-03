const { chromium } = require(process.env.PW || 'playwright-core');
const APP='http://127.0.0.1:54321/index.html', URL_='http://127.0.0.1:54321', KEY='sb_publishable_test';
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  await fetch(URL_+'/__reset');
  const pg = await b.newPage({ viewport:{width:1280,height:1100} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text())});
  await pg.goto(APP); await pg.waitForTimeout(400);
  await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'T'}; Cloud.saveCfg();
    return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY]);
  await pg.waitForTimeout(900);

  const fresh = (nm) => pg.evaluate(n => {
    const src = Store.data.estimates.find(x => (x.items||[]).length);
    const e = JSON.parse(JSON.stringify(src));
    e.id = uid("est"); e.no = Store.nextEstNo(); e.status = "draft";
    delete e.approval; delete e.jobId; delete e.linkSentAt; e.customerId = null;
    e.lead = { name:n, phone:"780-555-3311", email:"x@example.com", address:"4 Flow St", city:"Edmonton" };
    Store.data.estimates.push(e); Store.save(); return e.id;
  }, nm);
  const st = id => pg.evaluate(i => { const e = Store.estimate(i);
    return { status:e.status, linkSentAt:e.linkSentAt||null,
             log:(e.log||[]).map(l=>l.text).join(' | ') }; }, id);
  const panel = async id => { await pg.evaluate(() => closeModal());
    await pg.evaluate(i => openEstimate(i), id); await pg.waitForTimeout(500);
    return pg.evaluate(() => document.querySelector('#modal-root').textContent.replace(/\s+/g,' ')); };

  console.log('--- backing out of the send screen ---');
  let a;
  await t('opening the link screen does NOT mark it sent', async () => {
    a = await fresh("Backed Out");
    await pg.evaluate(i => openEstimate(i), a); await pg.waitForTimeout(400);
    await pg.click(`[data-link-estimate="${a}"]`); await pg.waitForTimeout(1200);
    if (!await pg.$('#lk-note')) throw new Error('the send screen did not open');
    const s = await st(a);
    if (s.status !== 'draft') throw new Error('status jumped to ' + s.status);
    if (s.linkSentAt) throw new Error('it recorded a send time');
    if (/signing link to the customer/.test(s.log)) throw new Error('log claims it went: ' + s.log);
  });

  await t('and the record says so plainly instead of claiming it is out', async () => {
    const tx = await panel(a);
    if (!/haven't sent it yet/.test(tx)) throw new Error('no honest panel :: ' + tx.slice(0,260));
    if (/Out for signature/.test(tx)) throw new Error('still claims it is out with them');
  });

  console.log('--- actually sending it ---');
  await t('tapping Copy records the send, once', async () => {
    await pg.evaluate(() => closeModal());
    await pg.evaluate(i => openEstimate(i), a); await pg.waitForTimeout(400);
    await pg.click(`[data-link-estimate="${a}"]`); await pg.waitForTimeout(1200);
    await pg.click('[data-copy-link][data-sent-id]'); await pg.waitForTimeout(400);
    const s = await st(a);
    if (s.status !== 'sent') throw new Error('status is ' + s.status);
    if (!s.linkSentAt) throw new Error('no send time recorded');
    if (!/signing link to the customer/.test(s.log)) throw new Error('log: ' + s.log);
  });

  await t('now it does say it is out for signature', async () => {
    const tx = await panel(a);
    if (!/Out for signature/.test(tx)) throw new Error('no waiting panel :: ' + tx.slice(0,260));
    if (/haven't sent it yet/.test(tx)) throw new Error('still says unsent');
  });

  await t('the send button then offers to send the link again', async () => {
    const lbl = await pg.evaluate(i =>
      (document.querySelector('[data-link-estimate="'+i+'"]')||{}).textContent || '', a);
    if (!/again/.test(lbl)) throw new Error('button reads: ' + lbl);
  });

  console.log('--- the two send buttons are telling apart ---');
  await t('the highlighted send is the one that carries the link', async () => {
    const c = await fresh("Button Reader");
    await pg.evaluate(() => closeModal());
    await pg.evaluate(i => openEstimate(i), c); await pg.waitForTimeout(450);
    const btns = await pg.evaluate(i => {
      const g = sel => { const el = document.querySelector(sel);
        return el ? { txt: el.textContent.replace(/\s+/g,' ').trim(), cls: el.className } : null; };
      return { link: g('[data-link-estimate="'+i+'"]'), plain: g('[data-send-estimate="'+i+'"]') };
    }, c);
    if (!btns.link || !btns.plain) throw new Error('missing a send button');
    if (!/accent|primary/.test(btns.link.cls)) throw new Error('the link send is not the highlighted one: ' + btns.link.cls);
    if (/accent|primary/.test(btns.plain.cls)) throw new Error('the plain send is still highlighted: ' + btns.plain.cls);
    if (btns.link.txt === btns.plain.txt) throw new Error('both read the same');
    if (!/no link/i.test(btns.plain.txt)) throw new Error('plain button does not say it has no link: ' + btns.plain.txt);
  });

  await t('the link message carries a link; the plain one deliberately does not', async () => {
    const c = await fresh("Two Messages");
    await pg.evaluate(() => closeModal());
    await pg.evaluate(i => sendForSignature(i), c); await pg.waitForTimeout(1300);
    const withLink = await pg.inputValue('#lk-note');
    if (!/https?:\/\/\S+sign/.test(withLink)) throw new Error('no link in the signing message');
    await pg.evaluate(() => closeModal()); await pg.waitForTimeout(200);
    await pg.evaluate(i => sendEstimate(i), c); await pg.waitForTimeout(500);
    const plain = await pg.inputValue('#est-note');
    if (/sign#t=/.test(plain)) throw new Error('the plain message smuggled a signing link in');
    await pg.evaluate(() => closeModal());
  });

  console.log('--- GST follows the number in Data & Setup ---');
  await t('no GST number: not a word about tax, anywhere', async () => {
    await pg.evaluate(() => { Store.data.settings.gst = ""; Store.save(); });
    const c = await fresh("No Gst Yet");
    await pg.evaluate(i => sendForSignature(i), c); await pg.waitForTimeout(1300);
    const msg = await pg.inputValue('#lk-note');
    if (/GST/i.test(msg)) throw new Error('mentions GST with no number set: ' + msg.slice(0,160));
    await pg.evaluate(() => closeModal());
    await pg.evaluate(i => sendEstimate(i), c); await pg.waitForTimeout(400);
    if (/GST/i.test(await pg.inputValue('#est-note'))) throw new Error('plain message mentions GST');
    await pg.evaluate(() => closeModal());
    const r = await pg.evaluate(() => Store.taxRate());
    if (r !== 0) throw new Error('tax rate is ' + r + ' with no number');
  });

  await t('number in: every surface starts charging it', async () => {
    await pg.evaluate(() => { Store.data.settings.gst = "123456789 RT0001";
      Store.data.settings.gstRate = 5; Store.save(); });
    const c = await fresh("Gst Now On");
    const n = await pg.evaluate(i => { const e = Store.estimate(i);
      return { sub: Store.estimateTotal(e), tax: Store.estimateTax(e), gross: Store.estimateGross(e) }; }, c);
    if (Math.abs(n.tax - n.sub * 0.05) > 0.01) throw new Error(JSON.stringify(n));
    await pg.evaluate(i => sendEstimate(i), c); await pg.waitForTimeout(400);
    const msg = await pg.inputValue('#est-note');
    for (const w of ['Subtotal', 'GST 5%'])
      if (!msg.includes(w)) throw new Error('"' + w + '" missing from the message');
    await pg.evaluate(() => closeModal());
    await pg.evaluate(i => { $('#print-area').innerHTML = estimateDocHtml(Store.estimate(i)); }, c);
    if (!/GST 5%/.test(await pg.evaluate(() => $('#print-area').textContent)))
      throw new Error('no GST on the printed estimate');
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
