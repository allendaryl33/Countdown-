/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it if the app lives elsewhere. */
const APP = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1280,height:1000} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${APP}/index.html`); await pg.waitForTimeout(450);

  const eid = await pg.evaluate(() => {
    const e = Store.data.estimates.find(x => (x.items||[]).length && x.status === 'draft');
    const c = Store.estContact(e);
    if (!c.email) { if (e.lead) e.lead.email = 'cassie.moreau@example.com'; }
    Store.save(); return e.id;
  });

  console.log('--- the button he went looking for ---');
  await t('an estimate has a Send to customer button', async () => {
    await pg.evaluate(id => openEstimate(id), eid); await pg.waitForTimeout(400);
    if (!await pg.$(`[data-send-estimate="${eid}"]`)) throw new Error('no send button on the estimate');
  });

  await t('it opens a note with the lines, the total and the expiry in it', async () => {
    await pg.click(`[data-send-estimate="${eid}"]`); await pg.waitForTimeout(400);
    const note = await pg.inputValue('#est-note');
    const n = await pg.evaluate(id => {
      const e = Store.estimate(id);
      return { total: money(Store.estimateTotal(e)), first: (e.items||[])[0].desc, days: e.validDays || 30 };
    }, eid);
    if (!note.includes(n.total)) throw new Error('no total: ' + note.slice(0,120));
    if (!note.includes(n.first)) throw new Error('line items missing');
    if (!note.includes('Good for ' + n.days + ' days')) throw new Error('no expiry');
    console.log('       ' + note.split('\n')[0] + ' … ' + n.total);
  });

  await t('the email link carries what is on screen, edits and all', async () => {
    await pg.fill('#est-note', 'Hi Cassie — numbers attached. Allen');
    await pg.waitForTimeout(150);
    const href = await pg.getAttribute('#est-mail', 'href');
    if (!/^mailto:/.test(href)) throw new Error('not a mailto: ' + href);
    if (!decodeURIComponent(href).includes('numbers attached')) throw new Error('did not pick up the edit');
    if (!/subject=.*EST-/.test(href)) throw new Error('no estimate number in the subject');
  });

  await t('the text link is a real sms: link to their number', async () => {
    const href = await pg.getAttribute('#est-sms', 'href');
    if (href && !/^sms:\+?\d/.test(href)) throw new Error('bad sms href: ' + href);
  });

  await t('sending marks it Sent and writes it into the estimate log', async () => {
    const before = await pg.evaluate(id => Store.estimate(id).status, eid);
    if (before !== 'draft') throw new Error('started as ' + before);
    await pg.evaluate(id => {
      document.querySelector(`[data-est-sent="${id}:Emailed"]`).removeAttribute('href');
    }, eid);
    await pg.click(`[data-est-sent="${eid}:Emailed"]`); await pg.waitForTimeout(400);
    const after = await pg.evaluate(id => {
      const e = Store.estimate(id);
      return { status:e.status, sentAt: !!e.sentAt, log: e.log.map(l=>l.text).join(' | ') };
    }, eid);
    if (after.status !== 'sent') throw new Error('status ' + after.status);
    if (!after.sentAt) throw new Error('no sent timestamp');
    if (!/Emailed the estimate/.test(after.log)) throw new Error('not in the log: ' + after.log);
  });

  await t('a blank estimate says so instead of sending nothing', async () => {
    const blank = await pg.evaluate(() => {
      const e = Store.estimate(Store.data.estimates[0].id);
      const copy = Object.assign({}, e, { id:'est_blank', no:9999, items:[], status:'draft' });
      Store.data.estimates.push(copy); Store.save(); return copy.id;
    });
    await pg.evaluate(() => closeModal());
    await pg.evaluate(id => sendEstimate(id), blank); await pg.waitForTimeout(350);
    const tx = await pg.evaluate(() => document.querySelector('.modal-body').textContent);
    if (!/Not ready to send/.test(tx)) throw new Error('let a blank estimate through');
  });

  console.log('--- signatures: sign one for real and follow it through ---');
  // The sample shop ships with no signed waivers, so sign one the way he
  // does: open a job, pick a waiver, tick the boxes, draw on the pad.
  let wid = null, signJob = null;
  await t('signing on screen records a real image', async () => {
    await pg.evaluate(() => closeModal());
    signJob = await pg.evaluate(() => {
      const j = Store.data.jobs.find(x => x.customerId);
      if (!Store.jobTotal(j)) { j.laborHours = 2; j.laborRate = 145; }
      Store.save(); return j.id;
    });
    await pg.evaluate(id => openWaiverSign(Store.activeTemplates()[0].id, id), signJob);
    await pg.waitForTimeout(500);
    if (!await pg.$('#sigpad')) throw new Error('no signature pad on screen');

    // tick every acknowledgment, name it, then draw
    await pg.$$eval('.wv-ack', bs => bs.forEach(b => { if (!b.checked) b.click(); }));
    await pg.fill('#wv-name', 'Dave Broadfoot');
    const pad = await pg.$('#sigpad');
    await pad.scrollIntoViewIfNeeded(); await pg.waitForTimeout(250);
    const box = await pad.boundingBox();
    await pg.mouse.move(box.x + 30, box.y + box.height * 0.6);
    await pg.mouse.down();
    for (let i = 1; i <= 14; i++)
      await pg.mouse.move(box.x + 30 + i * 14, box.y + box.height * (0.6 - Math.sin(i / 2) * 0.22));
    await pg.mouse.up();
    await pg.mouse.move(5, 5);
    await pg.waitForTimeout(250);
    const inked = await pg.evaluate(() => (typeof SigPad !== 'undefined' && !!SigPad.dirty));
    if (!inked) throw new Error('the pad did not register the drawing at all');

    await pg.evaluate(() => document.querySelector('[data-sign-waiver]').click());
    await pg.waitForTimeout(800);
    const w = await pg.evaluate(() => {
      const w = Store.data.signedWaivers[Store.data.signedWaivers.length - 1];
      return w ? { id:w.id, who:w.signerName, job:w.jobId,
                   kind:String(w.signature||'').slice(0,22), len:String(w.signature||'').length } : null;
    });
    if (!w) throw new Error('nothing was saved');
    if (!/^data:image\/png/.test(w.kind)) throw new Error('signature is not an image: ' + w.kind);
    if (w.len < 300) throw new Error('suspiciously tiny: ' + w.len + ' bytes');
    if (w.who !== 'Dave Broadfoot') throw new Error('signer ' + w.who);
    wid = w.id; signJob = w.job || signJob;
    console.log('       ' + w.who + ' — ' + Math.round(w.len/1024) + 'KB png saved');
  });

  await t('it will not save without ink on the pad', async () => {
    await pg.evaluate(() => closeModal());
    await pg.evaluate(id => openWaiverSign(Store.activeTemplates()[0].id, id), signJob);
    await pg.waitForTimeout(500);
    const n0 = await pg.evaluate(() => Store.data.signedWaivers.length);
    await pg.$$eval('.wv-ack', bs => bs.forEach(b => { if (!b.checked) b.click(); }));
    await pg.fill('#wv-name', 'Nobody');
    await pg.click('[data-sign-waiver]'); await pg.waitForTimeout(400);
    const n1 = await pg.evaluate(() => Store.data.signedWaivers.length);
    if (n1 !== n0) throw new Error('saved an unsigned waiver');
    const err = await pg.isVisible('#wv-sig-err');
    if (!err) throw new Error('did not say a signature was required');
    await pg.evaluate(() => closeModal());
  });

  await t('it shows on the signed-waiver record', async () => {
    await pg.evaluate(i => openSignedWaiver(i), wid); await pg.waitForTimeout(400);
    const img = await pg.$('#modal-root img[alt^="Signature"]');
    if (!img) throw new Error('no signature image in the record');
    const box = await img.boundingBox();
    if (!box || box.width < 20 || box.height < 10) throw new Error('rendered empty: ' + JSON.stringify(box));
    console.log('       drawn at ' + Math.round(box.width) + 'x' + Math.round(box.height));
  });

  await t('it comes out on the printed waiver', async () => {
    await pg.evaluate(i => { $('#print-area').innerHTML = waiverDocHtml(Store.signedWaiver(i)); }, wid);
    await pg.waitForTimeout(300);
    const n = await pg.evaluate(() => document.querySelectorAll('#print-area img[src^="data:image/png"]').length);
    if (!n) throw new Error('printed copy has no signature image');
  });

  await t('and on the invoice, which is what the customer keeps', async () => {
    await pg.evaluate(() => closeModal());
    await pg.evaluate(id => previewInvoice(id), signJob); await pg.waitForTimeout(1000);
    const r = await pg.evaluate(() => {
      const el = document.querySelector('.inv-preview');
      const sig = Array.from(el.querySelectorAll('img')).filter(i => /^data:image\/png/.test(i.src));
      return { sigs: sig.length, w: sig[0] ? Math.round(sig[0].getBoundingClientRect().width) : 0,
               text: el.textContent.replace(/\s+/g,' ') };
    });
    if (!r.sigs) throw new Error('no signature on the invoice');
    if (r.w < 20) throw new Error('signature rendered at ' + r.w + 'px wide');
    if (!/Dave Broadfoot/.test(r.text)) throw new Error('signer not named on it');
    console.log('       signature on the invoice, ' + r.w + 'px wide, signed by Dave Broadfoot');
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
