/* A typo in a line used to mean deleting it and typing the whole thing again. */
/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1280,height:1000} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  const eid = await pg.evaluate(() => {
    const e = Store.data.estimates.find(x => (x.items||[]).length);
    e.status = "draft"; delete e.approval;
    e.items = [{ desc:"Remove and dipose of old shower base", kind:"labor", qty:1, price:0 },
               { desc:"Plumb & install", kind:"labor", qty:2, price:150 }];
    Store.save(); return e.id;
  });
  const open = async () => { await pg.evaluate(id => openEstimate(id), eid); await pg.waitForTimeout(450); };
  const line = i => pg.evaluate(([id,n]) => Store.estimate(id).items[n], [eid,i]);

  await open();

  await t('every line is editable where it sits', async () => {
    const n = await pg.evaluate(() => document.querySelectorAll('[data-line-edit]').length);
    if (n !== 8) throw new Error(n + ' editable fields for 2 lines (expected 8)');
  });

  await t('fixing a typo in the description sticks', async () => {
    const sel = `[data-line-edit="${eid}:0:desc"]`;
    await pg.fill(sel, "Remove and dispose of old shower base, glass doors and valve");
    await pg.evaluate(s => document.querySelector(s).blur(), sel);
    await pg.waitForTimeout(350);
    const it = await line(0);
    if (!/dispose of old shower base, glass doors and valve/.test(it.desc))
      throw new Error('description is still "' + it.desc + '"');
  });

  await t('a price change recalculates that line and the estimate total', async () => {
    const sel = `[data-line-edit="${eid}:0:price"]`;
    await pg.fill(sel, "2400");
    await pg.evaluate(s => document.querySelector(s).blur(), sel);
    await pg.waitForTimeout(350);
    const it = await line(0);
    if (it.price !== 2400) throw new Error('price is ' + it.price);
    const shown = await pg.evaluate(() => ({
      row: document.querySelector('[data-line-total="0"]').textContent.trim(),
      tot: document.querySelector('[data-est-total]').textContent.trim() }));
    if (!/2,400/.test(shown.row)) throw new Error('line total shows ' + shown.row);
    if (!/2,700/.test(shown.tot)) throw new Error('estimate total shows ' + shown.tot);
    const real = await pg.evaluate(id => Store.estimateTotal(Store.estimate(id)), eid);
    if (real !== 2700) throw new Error('stored total is ' + real);
  });

  await t('quantity edits too', async () => {
    const sel = `[data-line-edit="${eid}:1:qty"]`;
    await pg.fill(sel, "3");
    await pg.evaluate(s => document.querySelector(s).blur(), sel);
    await pg.waitForTimeout(350);
    const it = await line(1);
    if (Number(it.qty) !== 3) throw new Error('qty is ' + it.qty);
    const tot = await pg.evaluate(id => Store.estimateTotal(Store.estimate(id)), eid);
    if (tot !== 2850) throw new Error('total is ' + tot + ', expected 2850');
  });

  await t('and the kind', async () => {
    const sel = `[data-line-edit="${eid}:1:kind"]`;
    const other = await pg.evaluate(() => LINE_KINDS.find(k => k.id !== "labor").id);
    await pg.selectOption(sel, other);
    await pg.waitForTimeout(350);
    const it = await line(1);
    if (it.kind !== other) throw new Error('kind is ' + it.kind);
  });

  await t('the record is not rebuilt under him mid-edit', async () => {
    const sel = `[data-line-edit="${eid}:0:desc"]`;
    await pg.focus(sel);
    const kept = await pg.evaluate(async s => {
      const el = document.querySelector(s);
      el.focus();
      renderQuiet();                       // what a background sync would do
      await new Promise(r => setTimeout(r, 200));
      return document.activeElement === document.querySelector(s);
    }, sel);
    if (!kept) throw new Error('focus was lost — the modal got rebuilt');
  });

  await t('a negative price is refused rather than stored', async () => {
    const sel = `[data-line-edit="${eid}:1:price"]`;
    await pg.fill(sel, "-50");
    await pg.evaluate(s => document.querySelector(s).blur(), sel);
    await pg.waitForTimeout(300);
    const it = await line(1);
    if (Number(it.price) < 0) throw new Error('stored ' + it.price);
  });

  await t('it survives closing and reopening', async () => {
    await pg.evaluate(() => closeModal()); await pg.waitForTimeout(200);
    await pg.reload(); await pg.waitForTimeout(600);
    const it = await line(0);
    if (it.price !== 2400) throw new Error('price came back as ' + it.price);
    if (!/glass doors and valve/.test(it.desc)) throw new Error('description came back as ' + it.desc);
  });

  await t('the X still removes a line', async () => {
    await open();
    const before = await pg.evaluate(id => Store.estimate(id).items.length, eid);
    pg.on('dialog', d => d.accept());
    await pg.click(`[data-del-line="${eid}:1"]`); await pg.waitForTimeout(400);
    const after = await pg.evaluate(id => Store.estimate(id).items.length, eid);
    if (after !== before - 1) throw new Error('lines went ' + before + ' → ' + after);
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
