/* Line order is the order of the work, and the customer reads it top to
   bottom. New lines land at the bottom, so until now a wrong sequence meant
   deleting and retyping the lot — he hit this on a real quote. */
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

  const eid = await pg.evaluate(() => {
    const e = Store.data.estimates.find(x => (x.items||[]).length) || Store.data.estimates[0];
    e.status = "draft"; delete e.approval;
    e.items = [
      { desc:"Demo and haul away", kind:"labor", qty:1, price:400 },
      { desc:"Rough-in the valve",  kind:"labor", qty:1, price:900 },
      { desc:"Tile and grout",      kind:"labor", qty:1, price:700 }];
    Store.save(); return e.id;
  });
  const open  = async () => { await pg.evaluate(id => openEstimate(id), eid); await pg.waitForTimeout(400); };
  const order = () => pg.evaluate(id => Store.estimate(id).items.map(i => i.desc), eid);

  await t('every line has a way to move it', async () => {
    await open();
    const n = await pg.$$eval('[data-line-move]', e => e.length);
    if (n !== 6) throw new Error(n + ' buttons for 3 lines, wanted 6');
  });

  await t('the ends are capped — no moving off the top or bottom', async () => {
    const r = await pg.evaluate(id => ({
      firstUp:  document.querySelector(`[data-line-move="${id}:0:-1"]`).disabled,
      lastDown: document.querySelector(`[data-line-move="${id}:2:1"]`).disabled,
      midUp:    document.querySelector(`[data-line-move="${id}:1:-1"]`).disabled }), eid);
    if (!r.firstUp || !r.lastDown) throw new Error('ends not capped: ' + JSON.stringify(r));
    if (r.midUp) throw new Error('the middle row should be movable');
  });

  await t('the last line can be brought to the top, one step at a time', async () => {
    await pg.click(`[data-line-move="${eid}:2:-1"]`); await pg.waitForTimeout(350);
    await pg.click(`[data-line-move="${eid}:1:-1"]`); await pg.waitForTimeout(350);
    const o = await order();
    if (o[0] !== "Tile and grout") throw new Error(JSON.stringify(o));
  });

  await t('moving down works too', async () => {
    await pg.click(`[data-line-move="${eid}:0:1"]`); await pg.waitForTimeout(350);
    const o = await order();
    if (o[1] !== "Tile and grout") throw new Error(JSON.stringify(o));
  });

  await t('the money is untouched by a reorder', async () => {
    const r = await pg.evaluate(id => {
      const e = Store.estimate(id);
      return { total: Store.estimateTotal(e), n: e.items.length,
               prices: e.items.map(i => i.price).sort((a,b)=>a-b) }; }, eid);
    if (r.n !== 3) throw new Error('lost a line: ' + r.n);
    if (r.total !== 2000) throw new Error('total is ' + r.total);
    if (JSON.stringify(r.prices) !== JSON.stringify([400,700,900])) throw new Error(JSON.stringify(r.prices));
  });

  await t('a description typed but not committed is not lost to the rebuild', async () => {
    await open();
    await pg.fill(`[data-line-edit="${eid}:0:desc"]`, "Edited right before moving");
    await pg.click(`[data-line-move="${eid}:0:1"]`); await pg.waitForTimeout(400);
    const o = await order();
    if (!o.includes("Edited right before moving"))
      throw new Error('the edit was thrown away: ' + JSON.stringify(o));
  });

  await t('the new order survives a reload', async () => {
    const before = await order();
    await pg.reload(); await pg.waitForTimeout(600);
    const after = await order();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(JSON.stringify({before,after}));
  });

  /* The first version of this checked the PAGE for sideways scroll and
     passed, while the buttons sat off the right edge of a table scrolling
     inside its own box. What matters is whether a thumb can reach them, so
     that is what it asks now: are they actually inside the viewport. */
  await t('all three buttons are on screen and tappable at phone width', async () => {
    await open();
    const vw = await pg.evaluate(() => window.innerWidth);
    for (const sel of [`${eid}:1:-1`, `${eid}:1:1`]) {
      const r = await pg.evaluate(s => {
        const b = document.querySelector(`[data-line-move="${s}"]`).getBoundingClientRect();
        return { w:b.width, h:b.height, left:b.left, right:b.right }; }, sel);
      if (r.w < 20 || r.h < 20) throw new Error(`${sel} is ${Math.round(r.w)}x${Math.round(r.h)}, too small to tap`);
      if (r.right > vw + 1 || r.left < 0)
        throw new Error(`${sel} is off screen (left ${Math.round(r.left)}, right ${Math.round(r.right)}, viewport ${vw})`);
    }
    const del = await pg.evaluate(id => {
      const b = document.querySelector(`[data-del-line="${id}:1"]`).getBoundingClientRect();
      return { right:b.right, w:b.width }; }, eid);
    if (del.right > vw + 1) throw new Error('the remove button is off screen too');
  });

  /* The action column is pinned to the right so it stays reachable while the
     table scrolls. Pinning risks covering the line total, so this checks the
     total is fully clear once scrolled across — it was verified at 372px
     against 372px, touching and not overlapping. */
  await t('pinning the buttons does not hide the line total', async () => {
    await open();
    const r = await pg.evaluate(() => {
      const cell = document.querySelector('[data-line-total]');
      const box  = cell.closest('table').parentElement;
      box.scrollLeft = box.scrollWidth;
      const t = cell.getBoundingClientRect();
      const a = cell.closest('tr').querySelector('.li-act').getBoundingClientRect();
      return { overlap: Math.round(t.right - a.left), total: Math.round(t.width) };
    });
    if (r.total < 30) throw new Error('the line total has been squashed to ' + r.total + 'px');
    if (r.overlap > 1) throw new Error('the buttons cover the total by ' + r.overlap + 'px when scrolled across');
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
