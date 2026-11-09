/* What he types into a money box is what gets saved — or he's told it wasn't.

   From the Nov 9 backlog:
   - Option B on EST-2007 was typed in at $1,625, showed on screen, and was
     $0 after a reload. Only retyping it digit by digit stuck.
   - On EST-2008 the camera line, priced at $350, read $0 after another line
     was added, with nobody touching it.
   - A materials cost box gained a cent, or lost the figure on Enter.
   - Materials came to $86.30 against a receipt of $86.32.
   - "Just how long" showed 0.5 in the hours box and refused to save it.

   The money boxes were type="number". A number box hands the page an empty
   string for anything it won't parse — "$1,625" on an iPhone — while still
   showing it, and every reader took empty as $0. Desktop number boxes also
   step on a scroll or an arrow key. Headless Chromium won't let a number box
   hold "$1,625" at all, so these tests drive the boxes as they are now (text,
   decimal keypad) with exactly what he'd type.                              */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP=`file://${REPO_DIR}/index.html`, errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1400,height:1100} });
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await pg.goto(APP); await pg.waitForTimeout(500);
  await pg.evaluate(()=>localStorage.clear()); await pg.reload(); await pg.waitForTimeout(400);

  const eid = await pg.evaluate(() => {
    const e = Store.data.estimates.find(x => x.status !== 'approved') || Store.data.estimates[0];
    e.status = 'draft'; delete e.approval; e.jobId = null; e.chosen = null; delete e.options;
    e.flatPrice = null;
    e.items = [
      { desc:'Sewer camera inspection', kind:'labor', qty:1, price:350 },
      { desc:'Locate and mark',         kind:'labor', qty:1, price:350 }
    ];
    Store.save(); return e.id;
  });
  const open = async () => { await pg.evaluate(i => { closeModal(); openEstimate(i); }, eid); await pg.waitForTimeout(350); };
  const reload = async () => { await pg.reload(); await pg.waitForTimeout(450); };
  const est = () => pg.evaluate(i => Store.estimate(i), eid);
  /* Its "edit" button is greyed out while that option is the one open. */
  const pickOpt = async o => {
    const sel = `.modal [data-opt-open="${eid}:${o}"]`;
    if (await pg.$eval(sel, e => !e.disabled)){ await pg.click(sel); await pg.waitForTimeout(300); }
  };
  const toastText = () => pg.evaluate(() => [...document.querySelectorAll('.toast, #toast, [class*="toast"]')].map(x => x.textContent).join(' | '));

  console.log('--- an option price, typed the way he types it ---');
  await t('"$1,625" in an option\'s price box is saved as $1,625, and survives a reload', async () => {
    await open();
    await pg.click('.modal [data-opt-add]'); await pg.waitForTimeout(300);
    await pg.click('.modal [data-opt-add]'); await pg.waitForTimeout(300);
    const opts = await pg.evaluate(i => Store.estOptions(Store.estimate(i)).map(o => o.optId), eid);
    if (opts.length < 2) throw new Error('options: '+opts.length);
    await pickOpt(opts[1]);
    await pg.fill('#est-flat', '$1,625');
    await pg.keyboard.press('Tab'); await pg.waitForTimeout(250);
    const now = await pg.evaluate(([i,o]) => Store.estOptions(Store.estimate(i)).find(x => x.optId === o).flatPrice, [eid, opts[1]]);
    if (now !== 1625) throw new Error('saved as '+now);
    const log = await pg.evaluate(i => (Store.estimate(i).log||[]).map(l => l.text).join(' ~ '), eid);
    if (!/Flat price set to \$1,625\.00/.test(log)) throw new Error('no "Flat price set" in the activity: '+log.slice(-200));
    await reload();
    const after = await pg.evaluate(([i,o]) => Store.estOptions(Store.estimate(i)).find(x => x.optId === o).flatPrice, [eid, opts[1]]);
    if (after !== 1625) throw new Error('after reload: '+after);
    console.log('       1625 saved, logged, and still there after a reload');
  });
  await t('the option\'s row shows the new price straight away, not after a reload', async () => {
    await open();
    const opts = await pg.evaluate(i => Store.estOptions(Store.estimate(i)).map(o => o.optId), eid);
    await pickOpt(opts[1]);
    await pg.fill('#est-flat', '1800');
    await pg.keyboard.press('Tab'); await pg.waitForTimeout(250);
    const row = await pg.$eval(`[data-opt-total="${opts[1]}"]`, e => e.textContent.trim());
    if (row !== '$1,800.00') throw new Error('row reads '+row);
  });
  await t('closing with Escape while still in the box saves what was typed', async () => {
    const opts = await pg.evaluate(i => Store.estOptions(Store.estimate(i)).map(o => o.optId), eid);
    await pg.click('#est-flat'); await pg.fill('#est-flat', '1625');
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
    if (await pg.$('#modal-root .modal')) throw new Error('sheet did not close');
    const v = await pg.evaluate(([i,o]) => Store.estOptions(Store.estimate(i)).find(x => x.optId === o).flatPrice, [eid, opts[1]]);
    if (v !== 1625) throw new Error('lost on close: '+v);
  });
  await t('something it can\'t read is refused out loud, and the price stays what it was', async () => {
    await open();
    const opts = await pg.evaluate(i => Store.estOptions(Store.estimate(i)).map(o => o.optId), eid);
    await pickOpt(opts[1]);
    await pg.fill('#est-flat', '16o0');
    await pg.keyboard.press('Tab'); await pg.waitForTimeout(250);
    const v = await pg.evaluate(([i,o]) => Store.estOptions(Store.estimate(i)).find(x => x.optId === o).flatPrice, [eid, opts[1]]);
    if (v !== 1625) throw new Error('price changed to '+v);
    if (!await pg.$('#est-flat.invalid')) throw new Error('box not marked');
    const msg = await toastText();
    if (!/not saved/i.test(msg)) throw new Error('no warning: '+msg);
    console.log('       "' + msg.trim().slice(0,90) + '"');
  });

  console.log('--- a line\'s price only moves when that line is edited ---');
  await t('adding a line leaves the priced lines above it exactly as they were', async () => {
    await pg.evaluate(i => { const e = Store.estimate(i); delete e.options; e.flatPrice = null;
      e.items = [{ desc:'Sewer camera inspection', kind:'labor', qty:1, price:350 }]; Store.save(); }, eid);
    await open();
    const box = '[data-line-edit$=":0:price"]';
    await pg.click(box); await pg.fill(box, '$350.00');
    await pg.fill('#line-desc', 'Work beyond the included hours is billed at $100/hour');
    await pg.fill('#line-qty', '1'); await pg.fill('#line-price', '0');
    await pg.click('.modal [data-add-line]'); await pg.waitForTimeout(350);
    const items = (await est()).items;
    if (items.length !== 2) throw new Error('lines: '+items.length);
    if (items[0].price !== 350) throw new Error('camera line is now '+items[0].price);
    if (await pg.$eval('[data-est-total]', e=>e.textContent.trim()) !== '$350.00') throw new Error('total off');
  });
  await t('an unreadable price on a line is refused — it does not become $0', async () => {
    const box = '[data-line-edit$=":0:price"]';
    await pg.fill(box, '3S0');
    await pg.click('#line-desc'); await pg.waitForTimeout(250);
    const p = (await est()).items[0].price;
    if (p !== 350) throw new Error('price became '+p);
    await pg.fill(box, '350'); await pg.click('#line-desc'); await pg.waitForTimeout(200);
  });
  await t('a change to a line\'s money is written in the activity, old and new', async () => {
    const box = '[data-line-edit$=":0:price"]';
    await pg.fill(box, '375'); await pg.click('#line-desc'); await pg.waitForTimeout(250);
    const log = await pg.evaluate(i => (Store.estimate(i).log||[]).map(l => l.text).join(' ~ '), eid);
    if (!/Line changed: Sewer camera inspection — \$350\.00 → \$375\.00/.test(log)) throw new Error(log.slice(-250));
  });
  await t('a scroll over a price box can\'t nudge it', async () => {
    const type = await pg.$eval('[data-line-edit$=":0:price"]', e => e.type);
    const flat = await pg.$eval('#est-flat', e => e.type);
    if (type !== 'text' || flat !== 'text') throw new Error('still number boxes: '+type+' '+flat);
  });
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);

  console.log('--- materials ---');
  let jid;
  await t('every line is rounded to the cent before the total, like the receipt', async () => {
    jid = await pg.evaluate(() => {
      const j = Store.data.jobs[0];
      j.materials = [
        { id:'m1', text:'1/2" PEX elbow',  qty:3, cost:1.115, got:true, from:'job', addedAt:1 },
        { id:'m2', text:'1/2" PEX tee',    qty:3, cost:1.115, got:true, from:'job', addedAt:2 },
        { id:'m3', text:'Crimp ring 100pk', qty:1, cost:12.40, got:true, from:'job', addedAt:3 }
      ];
      Store.save(); return j.id;
    });
    // 3 × 1.115 is 3.345, which a till prints as 3.35. Two of those and the
    // rings: 3.35 + 3.35 + 12.40 = 19.10. Unrounded it came to 19.09.
    const sum = await pg.evaluate(id => Store.materialsCost(Store.job(id)), jid);
    if (sum !== 19.10) throw new Error('total '+sum);
    await pg.evaluate(id => openJob(id), jid); await pg.waitForTimeout(300);
    const shown = await pg.$eval('.mat-cost', e => e.textContent);
    if (!/\$19\.10/.test(shown)) throw new Error('shows '+shown);
    console.log('       $19.10, not $19.09');
  });
  await t('a cost typed with a dollar sign and Enter keeps exactly what was typed', async () => {
    const box = '[data-mat-cost$=":m3"]';
    await pg.fill(box, '$12.43'); await pg.press(box, 'Enter'); await pg.waitForTimeout(300);
    const c = await pg.evaluate(id => Store.job(id).materials.find(m => m.id === 'm3').cost, jid);
    if (c !== 12.43) throw new Error('saved '+c);
    const shown = await pg.$eval('[data-mat-cost$=":m3"]', e => e.value);
    if (shown !== '12.43') throw new Error('box now reads '+shown);
  });
  await t('a three-decimal unit price is kept as typed, not trimmed', async () => {
    const box = '[data-mat-cost$=":m1"]';
    await pg.fill(box, '1.237'); await pg.keyboard.press('Tab'); await pg.waitForTimeout(300);
    const c = await pg.evaluate(id => Store.job(id).materials.find(m => m.id === 'm1').cost, jid);
    if (c !== 1.237) throw new Error('saved '+c);
  });
  await t('a cost it can\'t read leaves the line alone and says so', async () => {
    const box = '[data-mat-cost$=":m3"]';
    await pg.fill(box, '12,4'); await pg.keyboard.press('Tab'); await pg.waitForTimeout(300);
    const c = await pg.evaluate(id => Store.job(id).materials.find(m => m.id === 'm3').cost, jid);
    if (c !== 12.43) throw new Error('changed to '+c);
    if (!/not saved/i.test(await toastText())) throw new Error('no warning');
  });
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);

  console.log('--- the hours box ---');
  await t('"Just how long" opens with an empty hours box, and what he types is what saves', async () => {
    await pg.evaluate(i => openEstimate(i), eid); await pg.waitForTimeout(300);
    await pg.click('.modal [data-add-time]'); await pg.waitForTimeout(250);
    await pg.click('.modal [data-te-mode="dur"]');
    const st = await pg.$eval('#te-hours', e => ({ v: e.value, ph: e.placeholder }));
    if (st.v !== '' || st.ph) throw new Error('box shows something that is not there: '+JSON.stringify(st));
    const hint = await pg.$eval('#te-dur', e => e.textContent);
    if (!/0\.5 or 1:30/.test(hint)) throw new Error('no hint beside the box');
    await pg.fill('#te-hours', '0.5'); await pg.click('.modal [data-save-time]'); await pg.waitForTimeout(300);
    const mins = await pg.evaluate(i => Math.round(Store.totalMs(Store.estimate(i))/60000), eid);
    if (mins !== 30) throw new Error('mins '+mins);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
  });

  console.log('--- copying out of the app ---');
  await t('a hand-selected copy goes out as plain words, with no colours attached', async () => {
    const r = await pg.evaluate(() => {
      const host = document.createElement('div');
      host.style.cssText = 'color:#fff;background:#111';
      host.textContent = 'Hi Al — here is your estimate.';
      document.body.appendChild(host);
      const range = document.createRange(); range.selectNodeContents(host);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      const dt = new DataTransfer();
      const ev = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      host.remove();
      return { types: [...dt.types], text: dt.getData('text/plain'), stopped: ev.defaultPrevented };
    });
    if (!r.stopped) throw new Error('browser copy not replaced');
    if (r.types.join() !== 'text/plain') throw new Error('types: '+r.types);
    if (r.text !== 'Hi Al — here is your estimate.') throw new Error('text: '+r.text);
  });

  await b.close();
  const hard = errs.filter(e=>e.includes('CONSOLE')||e.includes('PAGEERROR'));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
