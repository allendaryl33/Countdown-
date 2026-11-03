const { chromium } = require(process.env.PW || 'playwright-core');
const APP='http://127.0.0.1:54321/index.html', URL_='http://127.0.0.1:54321', KEY='sb_publishable_test';
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  await fetch(URL_+'/__reset');
  const pg = await b.newPage({ viewport:{width:1280,height:1100} });
  pg.on('pageerror',e=>errs.push('APP PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('APP CONSOLE: '+m.text())});
  await pg.goto(APP); await pg.waitForTimeout(400);
  await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'T'}; Cloud.saveCfg();
    return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY]);
  await pg.waitForTimeout(900);

  const jid = await pg.evaluate(() => {
    Object.assign(Store.data.settings, {
      gst:'123456789 RT0001', gstRate:5, email:'admin@poseidonplumbing.ca',
      payStripeUrl:'https://buy.stripe.com/test_abc',
      payEtransfer:'admin@poseidonplumbing.ca', payCash:true,
      invoiceTermsMode:'completion'
    });
    const j = Store.data.jobs.find(x => (x.parts||[]).length) || Store.data.jobs[0];
    j.laborHours = 2; j.laborRate = 145; j.status = 'complete';
    j.payment = blankPayment();
    Store.save(); return j.id;
  });

  // Give the job the two things the invoice is supposed to carry, or the
  // assertions below pass by finding nothing and prove nothing.
  await t('set up: a signed waiver and two labelled photos on the job', async () => {
    const r = await pg.evaluate(async id => {
      const j = Store.job(id);
      // a signature, through the store the same way signing does
      Store.signWaiver(Store.activeTemplates()[0], {
        job: j, signerName: 'Daryl A', signerRole: 'Homeowner', fillIns: '',
        signature: 'data:image/png;base64,' + 'A'.repeat(400)
      });
      // two photos that really exist in storage, so they can be signed
      const png = Uint8Array.from(atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
        c => c.charCodeAt(0));
      j.photos = j.photos || [];
      for (const tag of ['before','after']){
        const path = 'jobs/' + j.id + '/' + tag + '.png';
        await Cloud.uploadPhoto(path, new Blob([png], { type:'image/png' }));
        j.photos.push({ id: uid('ph'), path, tag, up: true, at: Date.now() });
      }
      Store.save();
      return { sigs: Store.signedForJob(id).filter(w => w.signature).length,
               tagged: Store.photosOf(j).filter(p => p.tag).length };
    }, jid);
    if (r.sigs !== 1) throw new Error('waiver not signed: ' + r.sigs);
    if (r.tagged !== 2) throw new Error('photos not labelled: ' + r.tagged);
  });

  let link = null;
  console.log('--- sending it ---');
  await t('Send it to them publishes the invoice and writes the message', async () => {
    await pg.evaluate(id => previewInvoice(id), jid); await pg.waitForTimeout(900);
    if (!await pg.$(`[data-send-invoice="${jid}"]`)) throw new Error('no send button on the preview');
    await pg.click(`[data-send-invoice="${jid}"]`); await pg.waitForTimeout(1500);
    const note = await pg.inputValue('#iv-note');
    const m = note.match(/https?:\/\/\S+/);
    if (!m) throw new Error('no link in the message: ' + note.slice(0,160));
    link = m[0];
    if (!/invoice/.test(link)) throw new Error('not an invoice link: ' + link);
    const total = await pg.evaluate(id => money(Store.balance(Store.job(id))), jid);
    if (!note.includes(total)) throw new Error('no amount in the message');
    console.log('       ' + link.slice(0,58) + '…');
  });

  await t('sending marks it invoiced and logs it', async () => {
    const r = await pg.evaluate(id => {
      const j = Store.job(id);
      return { status:j.payment.status, no:j.invoiceNo, log:j.log.map(l=>l.text).join(' | ') }; }, jid);
    if (r.status !== 'invoiced') throw new Error('status ' + r.status);
    if (!r.no) throw new Error('no invoice number');
    if (!/Sent the invoice as a link/.test(r.log)) throw new Error('not logged');
  });

  await t('it says which ways they can pay', async () => {
    const tx = await pg.evaluate(() => document.querySelector('#modal-root').textContent.replace(/\s+/g,' '));
    for (const w of ['card','e-transfer','cash']) if (!tx.includes(w)) throw new Error('"'+w+'" not mentioned');
  });

  console.log('--- what the customer opens ---');
  const cust = await b.newPage({ viewport:{width:390,height:844} });
  cust.on('pageerror',e=>errs.push('INV PAGEERROR: '+e.message));
  cust.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('INV CONSOLE: '+m.text())});

  await t('the whole invoice is on it', async () => {
    await cust.goto(link); await cust.waitForTimeout(1200);
    const tx = await cust.evaluate(() => document.querySelector('#root').textContent.replace(/\s+/g,' '));
    const want = await pg.evaluate(id => {
      const j = Store.job(id);
      return { co: Store.data.settings.company, no: 'INV-' + j.invoiceNo,
               total: money(Store.invoiceTotal(j)), who: custName(j.customerId),
               first: Store.invoiceLines(j)[0].desc };
    }, jid);
    for (const w of [want.co, want.no, want.total, want.who, want.first]){
      if (!tx.includes(w)) throw new Error('"' + w + '" missing');
    }
    if (!/GST/.test(tx)) throw new Error('no tax line');
    if (!/completion of work/.test(tx)) throw new Error('terms not carried over');
    console.log('       ' + want.no + ', ' + want.total);
  });

  await t('all three ways to pay are on it, card as a real link', async () => {
    const tx = await cust.evaluate(() => document.querySelector('#root').textContent.replace(/\s+/g,' '));
    if (!/e-Transfer/i.test(tx)) throw new Error('no e-transfer');
    if (!/admin@poseidonplumbing\.ca/.test(tx)) throw new Error('e-transfer address missing');
    if (!/Cash/.test(tx)) throw new Error('no cash');
    const href = await cust.getAttribute('.pay', 'href');
    if (!href.startsWith('https://buy.stripe.com/test_abc')) throw new Error('card link: ' + href);
    // and it must carry the token, or Stripe's webhook cannot say which invoice
    if (!/client_reference_id=[0-9a-f]{32}/.test(href))
      throw new Error('no reference for the webhook: ' + href);
  });

  await t('the signature and labelled photos come through', async () => {
    const r = await cust.evaluate(() => ({
      sigs: document.querySelectorAll('.sig img').length,
      shots: document.querySelectorAll('.shots img').length,
      caps: Array.from(document.querySelectorAll('.shots figcaption')).map(x=>x.textContent.trim())
    }));
    const expect = await pg.evaluate(id => ({
      sig: Store.signedForJob(id).filter(w => w.signature).length,
      tagged: Store.photosOf(Store.job(id)).filter(p => p.tag).length }), jid);
    if (!expect.sig || !expect.tagged)
      throw new Error('nothing to check — this test would pass on an empty job');
    if (r.sigs !== expect.sig) throw new Error('signatures: ' + r.sigs + ' vs ' + expect.sig);
    if (r.shots !== expect.tagged) throw new Error('photos: ' + r.shots + ' vs ' + expect.tagged);
    if (expect.tagged && !r.caps.every(Boolean)) throw new Error('a photo lost its label');
    console.log('       ' + r.sigs + ' signature(s), ' + r.shots + ' labelled photo(s)');
  });

  await t('it reaches no other job and no other customer', async () => {
    const leak = await cust.evaluate(() => document.querySelector('#root').textContent);
    const others = await pg.evaluate(id => Store.data.jobs.filter(x => x.id !== id && x.invoiceNo)
      .map(x => 'INV-' + x.invoiceNo), jid);
    const found = others.filter(o => leak.includes(o));
    if (found.length) throw new Error('other invoices visible: ' + JSON.stringify(found));
  });

  await t('he can tell they opened it', async () => {
    await pg.evaluate(() => Cloud.pullInvoiceLinks()); await pg.waitForTimeout(500);
    const seen = await pg.evaluate(id => (Cloud.invoiceLinks||[])
      .filter(l => l.job_id === id).some(l => l.viewed_at), jid);
    if (!seen) throw new Error('the view was not recorded');
  });

  console.log('--- once it is paid ---');
  await t('a paid invoice shows paid, with no pay button', async () => {
    await pg.evaluate(id => { const j = Store.job(id);
      Store.setPayment(j, { status:'paid' }); return Cloud.publishInvoiceLink(j)
        .then(tok => { window.__paidLink = invoiceLinkUrl(tok); }); }, jid);
    await pg.waitForTimeout(1200);
    const paidLink = await pg.evaluate(() => window.__paidLink);
    await cust.goto('about:blank'); await cust.goto(paidLink); await cust.waitForTimeout(1100);
    const tx = await cust.evaluate(() => document.querySelector('#root').textContent.replace(/\s+/g,' '));
    if (!/Paid in full/.test(tx)) throw new Error(tx.slice(0,200));
    if (await cust.$('.pay')) throw new Error('still asking for money');
  });

  console.log('--- Stripe telling the app ---');
  await t('the card link carries the token, so the webhook knows which invoice', async () => {
    const href = await pg.evaluate(async id => {
      const j = Store.job(id);
      Store.setPayment(j, { status:'invoiced', amountPaid:0 });
      const tok = await Cloud.publishInvoiceLink(j);
      window.__tok = tok;
      const p = await fetch(URL_ + '/rest/v1/rpc/invoice_for_viewing', {
        method:'POST', headers:{'apikey':KEY,'Content-Type':'application/json'},
        body: JSON.stringify({ p_token: tok }) }).then(r=>r.json());
      return p.pay.stripe;
    }, jid).catch(async () => {
      // the page fetch above runs in the app's origin; fall back to reading it here
      return null;
    });
    const tok = await pg.evaluate(() => window.__tok);
    if (!tok) throw new Error('no token');
    const payload = await fetch(URL_+'/rest/v1/rpc/invoice_for_viewing', {
      method:'POST', headers:{'apikey':KEY,'Content-Type':'application/json'},
      body: JSON.stringify({ p_token: tok }) }).then(r=>r.json());
    const link = payload.pay.stripe;
    if (!link.includes('client_reference_id=' + tok))
      throw new Error('token not on the card link: ' + link);
    if (!/^https:\/\/buy\.stripe\.com/.test(link)) throw new Error('not the stripe link: ' + link);
    console.log('       ' + link.slice(0, 72) + '…');
  });

  await t('a Stripe payment marks the job paid without him touching it', async () => {
    const tok = await pg.evaluate(() => window.__tok);
    const total = await pg.evaluate(id => Store.invoiceTotal(Store.job(id)), jid);
    await fetch(URL_+'/__stripe-paid', { method:'POST',
      body: JSON.stringify({ token: tok, amount: total, ref: 'pi_3Abc' }) });
    await pg.evaluate(() => Cloud.pullInvoiceLinks()); await pg.waitForTimeout(700);
    const r = await pg.evaluate(id => {
      const j = Store.job(id);
      return { state: Store.payState(j), got: j.payment.amountPaid, method: j.payment.method,
               ref: j.payment.ref, bal: Store.balance(j),
               log: j.log.map(l=>l.text).join(' | ') }; }, jid);
    if (r.state !== 'paid') throw new Error('still ' + r.state);
    if (Math.abs(r.got - total) > 0.005) throw new Error('recorded ' + r.got + ' of ' + total);
    if (r.method !== 'Card') throw new Error('method ' + r.method);
    if (r.ref !== 'pi_3Abc') throw new Error('no Stripe reference: ' + r.ref);
    if (r.bal > 0.005) throw new Error('left a balance of ' + r.bal);
    if (!/Stripe told us/.test(r.log)) throw new Error('not logged: ' + r.log);
    console.log('       paid ' + r.got + ' by card, ref ' + r.ref);
  });

  await t('a second sync does not pay it twice', async () => {
    const before = await pg.evaluate(id => Store.job(id).payment.paidAt, jid);
    await pg.evaluate(() => Cloud.pullInvoiceLinks()); await pg.waitForTimeout(500);
    const after = await pg.evaluate(id => Store.job(id).payment.paidAt, jid);
    if (before !== after) throw new Error('overwrote the payment on a re-sync');
  });

  console.log('--- links that should not work ---');
  await t('a guessed token shows nothing', async () => {
    await cust.goto('about:blank');
    await cust.goto(link.replace(/t=[^&]+/, 't=' + 'f'.repeat(32))); await cust.waitForTimeout(900);
    const tx = await cust.evaluate(() => document.querySelector('#root').textContent.replace(/\s+/g,' '));
    if (!/expired/.test(tx)) throw new Error(tx.slice(0,160));
    if (/INV-/.test(tx)) throw new Error('leaked an invoice');
  });

  await t('Save as PDF is still there for a bookkeeper', async () => {
    await pg.evaluate(() => closeModal());
    await pg.evaluate(id => previewInvoice(id), jid); await pg.waitForTimeout(900);
    if (!await pg.$(`[data-inv-print="${jid}"]`)) throw new Error('lost the PDF route');
  });

  await t('the repo copy carries no key', async () => {
    const src = require('fs').readFileSync(`${APP}/invoice.html`,'utf8');
    if (!/const BAKED_URL = "";/.test(src) || !/const BAKED_KEY = "";/.test(src))
      throw new Error('a key got committed into invoice.html');
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
