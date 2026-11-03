/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1280,height:1100} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  const eid = await pg.evaluate(() => {
    const e = Store.data.estimates.find(x => (x.items||[]).length);
    e.status = 'draft'; delete e.approval; Store.save(); return e.id;
  });

  const draw = async () => {
    const pad = await pg.$('#sigpad');
    await pad.scrollIntoViewIfNeeded(); await pg.waitForTimeout(250);
    const box = await pad.boundingBox();
    await pg.mouse.move(box.x+40, box.y+box.height*0.62); await pg.mouse.down();
    for (let i=1;i<=20;i++) await pg.mouse.move(box.x+40+i*10, box.y+box.height*(0.62-Math.sin(i/2.2)*0.25));
    await pg.mouse.up(); await pg.mouse.move(5,5); await pg.waitForTimeout(250);
  };

  await t('there is a Sign & approve button on an estimate', async () => {
    await pg.evaluate(id => openEstimate(id), eid); await pg.waitForTimeout(400);
    if (!await pg.$(`[data-sign-estimate="${eid}"]`)) throw new Error('no sign button');
  });

  await t('it shows them what they are agreeing to, with the total', async () => {
    await pg.click(`[data-sign-estimate="${eid}"]`); await pg.waitForTimeout(400);
    const tx = await pg.evaluate(() => document.querySelector('.modal-body').textContent.replace(/\s+/g,' '));
    const n = await pg.evaluate(id => {
      const e = Store.estimate(id);
      return { total: money(Store.estimateTotal(e)), first: e.items[0].desc, days: e.validDays || 30 };
    }, eid);
    if (!tx.includes(n.total)) throw new Error('no total shown');
    if (!tx.includes(n.first)) throw new Error('lines not shown');
    if (!tx.includes('Good for ' + n.days + ' days')) throw new Error('no expiry');
  });

  await t('it refuses without a name', async () => {
    await pg.fill('#es-name', '');
    await draw();
    await pg.evaluate(id => document.querySelector(`[data-save-est-sign="${id}"]`).click(), eid);
    await pg.waitForTimeout(350);
    if (!await pg.isVisible('#es-name-err')) throw new Error('let it through with no name');
    if (await pg.evaluate(id => !!Store.estimate(id).approval, eid)) throw new Error('saved anyway');
  });

  await t('it refuses without a signature', async () => {
    await pg.click('[data-clear-sig]'); await pg.waitForTimeout(200);
    await pg.fill('#es-name', 'Cassie Moreau');
    await pg.evaluate(id => document.querySelector(`[data-save-est-sign="${id}"]`).click(), eid);
    await pg.waitForTimeout(350);
    if (!await pg.isVisible('#es-sig-err')) throw new Error('let it through unsigned');
    if (await pg.evaluate(id => !!Store.estimate(id).approval, eid)) throw new Error('saved anyway');
  });

  await t('signing approves it and freezes what they agreed to', async () => {
    await draw();
    await pg.selectOption('#es-role', 'Homeowner');
    await pg.evaluate(id => document.querySelector(`[data-save-est-sign="${id}"]`).click(), eid);
    await pg.waitForTimeout(700);
    const r = await pg.evaluate(id => {
      const e = Store.estimate(id);
      return { status:e.status, name:e.approval.name, role:e.approval.role,
               kind:String(e.approval.signature||'').slice(0,22), len:String(e.approval.signature||'').length,
               frozen:e.approval.total, live:Store.estimateTotal(e), lines:e.approval.items.length,
               decided:!!e.decidedAt, log:e.log.map(l=>l.text).join(' | ') };
    }, eid);
    if (r.status !== 'approved') throw new Error('status ' + r.status);
    if (!/^data:image\/png/.test(r.kind)) throw new Error('signature not an image: ' + r.kind);
    if (r.len < 300) throw new Error('tiny signature: ' + r.len);
    if (r.name !== 'Cassie Moreau') throw new Error('name ' + r.name);
    if (r.frozen !== r.live) throw new Error('froze the wrong total');
    if (!r.lines) throw new Error('did not freeze the line items');
    if (!r.decided) throw new Error('no decided date');
    if (!/Approved on screen by Cassie Moreau/.test(r.log)) throw new Error('not logged: ' + r.log);
    console.log('       ' + r.name + ', ' + Math.round(r.len/1024) + 'KB png, frozen at ' + money_(r.frozen));
    function money_(v){ return '$' + Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  });

  await t('the approval and the signature show on the estimate', async () => {
    await pg.evaluate(id => openEstimate(id), eid); await pg.waitForTimeout(400);
    const tx = await pg.evaluate(() => document.querySelector('#modal-root').textContent.replace(/\s+/g,' '));
    if (!/Approved by Cassie Moreau/.test(tx)) throw new Error('not shown on the record');
    const img = await pg.$('#modal-root img[alt^="Signature of"]');
    if (!img) throw new Error('no signature image');
    const box = await img.boundingBox();
    if (!box || box.width < 20) throw new Error('rendered empty');
    if (await pg.$(`[data-sign-estimate="${eid}"]`)) throw new Error('still offering to sign an approved estimate');
  });

  await t('editing it afterwards is flagged, loudly', async () => {
    await pg.evaluate(id => { const e = Store.estimate(id);
      e.items.push({ desc:'Extra valve', qty:1, price:120 }); Store.save(); }, eid);
    const drift = await pg.evaluate(id => Store.approvalDrift(Store.estimate(id)), eid);
    if (Math.abs(drift - 120) > 0.01) throw new Error('drift ' + drift);
    await pg.evaluate(id => openEstimate(id), eid); await pg.waitForTimeout(400);
    const tx = await pg.evaluate(() => document.querySelector('#modal-root').textContent.replace(/\s+/g,' '));
    if (!/Edited since they signed/.test(tx)) throw new Error('no warning after an edit');
    if (!/\$120\.00 more/.test(tx)) throw new Error('did not say how much: ' + tx.slice(0,300));
    console.log('       flagged $120.00 more than they agreed to');
  });

  await t('the printed estimate carries their mark, not a blank line', async () => {
    await pg.evaluate(id => { $('#print-area').innerHTML = estimateDocHtml(Store.estimate(id)); }, eid);
    await pg.waitForTimeout(300);
    const r = await pg.evaluate(() => ({
      imgs: document.querySelectorAll('#print-area img[src^="data:image/png"]').length,
      tx: document.querySelector('#print-area').textContent.replace(/\s+/g,' ') }));
    if (!r.imgs) throw new Error('no signature on the printed copy');
    if (!/Approved by Cassie Moreau/.test(r.tx)) throw new Error('signer not named');
    if (/Customer approval/.test(r.tx)) throw new Error('still showing the blank sign-here line');
  });

  await t('an unsigned estimate still prints blank lines to sign by hand', async () => {
    const other = await pg.evaluate(() => {
      const e = Store.data.estimates.find(x => !x.approval && (x.items||[]).length);
      return e ? e.id : null;
    });
    if (!other) { console.log('       (no unsigned estimate to check)'); return; }
    await pg.evaluate(id => { $('#print-area').innerHTML = estimateDocHtml(Store.estimate(id)); }, other);
    const tx = await pg.evaluate(() => document.querySelector('#print-area').textContent);
    if (!/Customer approval/.test(tx)) throw new Error('lost the blank line for pen-and-paper');
  });

  await t('an empty estimate cannot be approved', async () => {
    const blank = await pg.evaluate(() => {
      const e = Object.assign({}, Store.data.estimates[0], { id:'est_b', no:8888, items:[], approval:null, status:'draft' });
      Store.data.estimates.push(e); Store.save(); return e.id;
    });
    await pg.evaluate(() => closeModal());
    await pg.evaluate(id => openEstimateSign(id), blank); await pg.waitForTimeout(350);
    if (await pg.$('#sigpad')) throw new Error('opened a signing pad for an empty estimate');
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
