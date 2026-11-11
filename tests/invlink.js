/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
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

  /* Nov 11: e-Transfer costs him nothing, card costs a fee. In his words,
     on the invoice and in the message — card still a full button. */
  await t('it says e-transfer is the easiest way, and card works too', async () => {
    const tx = await cust.evaluate(() => document.querySelector('#root').innerText.replace(/\s+/g,' '));
    const line = "Easiest way to pay is e-transfer to admin@poseidonplumbing.ca — card works too, whatever's easier for you.";
    if (!tx.includes(line)) throw new Error('line missing: ' + tx.slice(tx.indexOf('Pay it'), tx.indexOf('Pay it') + 300));
    const order = await cust.evaluate(() => {
      const card = document.querySelector('.pay'), way = [...document.querySelectorAll('.way')].find(w => /e-Transfer/.test(w.textContent));
      return way.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING ? 'etransfer-first' : 'card-first';
    });
    if (order !== 'etransfer-first') throw new Error(order);
    await cust.screenshot({ path: (process.env.SP || __dirname) + '/inv-easiest.png', fullPage: true });
  });
  await t('the text message says the same, word for word', async () => {
    const note = await pg.evaluate(() => (document.querySelector('#iv-note') || {}).value || '');
    if (!note.includes("Easiest way to pay is e-transfer to admin@poseidonplumbing.ca — card works too, whatever's easier for you."))
      throw new Error(note);
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

  /* Stripe opens with the balance owing already in the box (whole cents,
     Stripe's prefilled_amount), ahead of the token, as Daryl specified. */
  const cardLink = async tok => (await fetch(URL_+'/rest/v1/rpc/invoice_for_viewing', {
      method:'POST', headers:{'apikey':KEY,'Content-Type':'application/json'},
      body: JSON.stringify({ p_token: tok }) }).then(r=>r.json())).pay.stripe;
  await t('the card link opens Stripe with the balance owing filled in, in cents', async () => {
    const tok = await pg.evaluate(() => window.__tok);
    const owing = await pg.evaluate(id => Store.balance(Store.job(id)), jid);
    const link = await cardLink(tok);
    const want = '?prefilled_amount=' + Math.round(owing * 100) + '&client_reference_id=' + tok;
    if (!link.endsWith(want)) throw new Error(link + ' — wanted it to end ' + want);
    console.log('       owing ' + owing.toFixed(2) + ' → ' + link.split('?')[1].slice(0, 40) + '…');
  });
  await t('after a part payment it fills in what is left, not the total', async () => {
    const r = await pg.evaluate(async id => {
      const j = Store.job(id);
      Store.setPayment(j, { status:'invoiced', amountPaid: 100 });
      const tok = await Cloud.publishInvoiceLink(j);
      const left = Store.balance(j);
      Store.setPayment(j, { status:'invoiced', amountPaid: 0 });   // put it back for the tests after
      return { tok, left, total: Store.invoiceTotal(j) };
    }, jid);
    const link = await cardLink(r.tok);
    const m = link.match(/prefilled_amount=(\d+)/);
    if (!m) throw new Error('no amount: ' + link);
    if (Number(m[1]) !== Math.round(r.left * 100)) throw new Error(m[1] + ' cents, but ' + r.left + ' is owing');
    if (Number(m[1]) === Math.round(r.total * 100)) throw new Error('it filled in the total, not the balance');
  });
  await t('a job with its own Stripe link gets the amount filled in too', async () => {
    const r = await pg.evaluate(async id => {
      const j = Store.job(id);
      j.payment.url = 'https://buy.stripe.com/test_job_own';
      const tok = await Cloud.publishInvoiceLink(j);
      const owing = Store.balance(j);
      j.payment.url = ''; Store.save();
      return { tok, owing };
    }, jid);
    const link = await cardLink(r.tok);
    const want = 'https://buy.stripe.com/test_job_own?prefilled_amount=' + Math.round(r.owing * 100) + '&client_reference_id=' + r.tok;
    if (link !== want) throw new Error(link);
  });
  await t('an invoice with nothing owing sends no amount — Stripe only takes a positive one', async () => {
    const r = await pg.evaluate(async id => {
      const j = Store.job(id);
      const was = j.payment.amountPaid;
      Store.setPayment(j, { status:'invoiced', amountPaid: Store.invoiceTotal(j) });
      const tok = await Cloud.publishInvoiceLink(j);
      Store.setPayment(j, { status:'invoiced', amountPaid: was || 0 });
      return tok;
    }, jid);
    const link = await cardLink(r);
    if (/prefilled_amount/.test(link)) throw new Error(link);
    if (!link.endsWith('?client_reference_id=' + r)) throw new Error(link);
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

  /* What came in is what's recorded. It used to mark any Stripe payment as
     paid in full: $100 on a $1,500 invoice read as settled, and a payment
     with no amount was assumed to be the whole total. */
  console.log('--- only what Stripe says came in ---');
  const freshJob = () => pg.evaluate(async () => {
    const j = Store.data.jobs.find(x => x.id !== window.__paidJob && (x.parts||[]).length && !(x.stripeSeen||[]).length
                                    && (!x.payment || x.payment.status !== 'paid'))
           || Store.data.jobs.find(x => x.id !== window.__paidJob && (!x.payment || x.payment.status !== 'paid'));
    j.status = 'complete'; j.laborHours = 2; j.laborRate = 145; j.payment = blankPayment();
    Store.setPayment(j, { status:'invoiced', amountPaid:0 });
    const tok = await Cloud.publishInvoiceLink(j);
    return { id: j.id, tok, total: Store.invoiceTotal(j) };
  });
  const stripePays = (tok, amount, ref) => fetch(URL_+'/__stripe-paid', { method:'POST',
    body: JSON.stringify({ token: tok, amount, ref }) });
  const state = id => pg.evaluate(id => { const j = Store.job(id);
    return { st: Store.payState(j), got: j.payment.amountPaid, bal: Store.balance(j),
             log: j.log.map(l => l.text).join(' | ') }; }, id);
  await pg.evaluate(id => { window.__paidJob = id; }, jid);

  let part;
  await t('a part payment is recorded as a part payment, with the rest still owing', async () => {
    part = await freshJob();
    await stripePays(part.tok, 100, 'pi_part1');
    await pg.evaluate(() => Cloud.pullInvoiceLinks()); await pg.waitForTimeout(500);
    const r = await state(part.id);
    if (r.st !== 'partial') throw new Error('state ' + r.st + ' — $100 of ' + part.total + ' is not paid');
    if (Math.abs(r.got - 100) > 0.005) throw new Error('recorded ' + r.got);
    if (Math.abs(r.bal - (part.total - 100)) > 0.005) throw new Error('balance ' + r.bal);
    if (!/\$100\.00 paid by card — Stripe told us\. \$[\d,]+\.\d\d still owing/.test(r.log)) throw new Error(r.log.slice(-200));
    console.log('       $100 of ' + part.total + ' recorded; ' + r.bal.toFixed(2) + ' still owing');
  });
  await t('syncing again does not add the same part payment twice', async () => {
    await pg.evaluate(() => Cloud.pullInvoiceLinks()); await pg.waitForTimeout(400);
    await pg.evaluate(() => Cloud.pullInvoiceLinks()); await pg.waitForTimeout(400);
    const r = await state(part.id);
    if (Math.abs(r.got - 100) > 0.005) throw new Error('now recorded ' + r.got);
  });
  await t('the rest paid on a second link settles it', async () => {
    const tok2 = await pg.evaluate(async id => Cloud.publishInvoiceLink(Store.job(id)), part.id);
    await stripePays(tok2, Math.round((part.total - 100) * 100) / 100, 'pi_part2');
    await pg.evaluate(() => Cloud.pullInvoiceLinks()); await pg.waitForTimeout(500);
    const r = await state(part.id);
    if (r.st !== 'paid') throw new Error('state ' + r.st + ', balance ' + r.bal);
    if (r.bal > 0.005) throw new Error('balance ' + r.bal);
  });
  await t('a payment with no amount records no money and says to check Stripe', async () => {
    const x = await freshJob();
    await stripePays(x.tok, 0, 'pi_noamt');
    await pg.evaluate(() => Cloud.pullInvoiceLinks()); await pg.waitForTimeout(500);
    const r = await state(x.id);
    if (r.st === 'paid') throw new Error('assumed the whole total');
    if ((Number(r.got) || 0) !== 0) throw new Error('recorded ' + r.got);
    if (!/didn't say how much — check Stripe/.test(r.log)) throw new Error(r.log.slice(-200));
  });
  await t('a Stripe payment on an invoice already paid another way is flagged, not added', async () => {
    const x = await freshJob();
    await pg.evaluate(id => Store.setPayment(Store.job(id), { status:'paid', method:'E-transfer' }), x.id);
    const before = await state(x.id);
    await stripePays(x.tok, x.total, 'pi_double');
    await pg.evaluate(() => Cloud.pullInvoiceLinks()); await pg.waitForTimeout(500);
    const r = await state(x.id);
    if (Math.abs(r.got - before.got) > 0.005) throw new Error('added to it: ' + before.got + ' → ' + r.got);
    if (!/already marked paid — check Stripe for a double payment/.test(r.log)) throw new Error(r.log.slice(-200));
  });

  /* Invoices Stripe already paid before stripeSeen existed carry no record
     of the token. Their own payment must not come back as a "double". */
  await t('an invoice Stripe already paid before this change is left quiet', async () => {
    const x = await freshJob();
    await pg.evaluate(id => { const j = Store.job(id);
      Store.setPayment(j, { status:'paid', method:'Card', ref:'pi_before', amountPaid: Store.invoiceTotal(j) });
      delete j.stripeSeen; Store.save(); }, x.id);
    const before = await state(x.id);
    await stripePays(x.tok, x.total, 'pi_before');
    await pg.evaluate(() => Cloud.pullInvoiceLinks()); await pg.waitForTimeout(500);
    const r = await state(x.id);
    if (r.log !== before.log) throw new Error('logged something: ' + r.log.slice(before.log.length));
    if (Math.abs(r.got - before.got) > 0.005) throw new Error('amount moved');
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

  /* Was: assert invoice.html carries no key. That is what broke — the values
     lived only in the deployed copy, a redeploy from the template wiped them,
     and a customer got a dead link. They belong in the repo, and secret
     material still must not. */
  await t('the repo copy carries the project, and no secret material', async () => {
    const fs = require('fs');
    const src = fs.readFileSync(`${REPO_DIR}/invoice.html`, 'utf8');
    if (!/const BAKED_URL = "https:\/\/[a-z0-9]+\.supabase\.co";/.test(src))
      throw new Error('invoice.html lost its project URL — short links from it are dead');
    if (!/const BAKED_KEY = "sb_publishable_[A-Za-z0-9_-]+";/.test(src))
      throw new Error('invoice.html lost its publishable key — short links from it are dead');
    if (/sb_secret_|eyJhbGciOi/.test(src))
      throw new Error('secret material got committed into invoice.html');
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
