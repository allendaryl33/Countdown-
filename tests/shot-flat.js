/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it if the app lives elsewhere. */
const APP = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const pg = await b.newPage({ viewport:{width:1100,height:1000}, deviceScaleFactor:2 });
  await pg.goto(`file://${APP}/index.html`); await pg.waitForTimeout(500);
  const id = await pg.evaluate(() => {
    Object.assign(Store.data.settings, { gst:'123456789 RT0001', gstRate:5 });
    const e = Store.data.estimates.find(x => (x.items||[]).length);
    e.status="draft"; delete e.approval; e.type = "Shower rebuild";
    e.items = [
      { desc:"Remove and dispose of; old shower base, glass doors, and necessary walls, shower control valve.", kind:"labor", qty:1, price:0 },
      { desc:"Plumb and install; shower base, shower control valve/trim. Moen Adler valve; base and glass selected by me to suit the space.", kind:"labor", qty:1, price:0 },
      { desc:"Apply waterproofing material (Red Guard), and any minor drywall (mudding/taping not included)", kind:"labor", qty:1, price:0 },
      { desc:"Tile and grout install, based on 5 sq ft tile", kind:"labor", qty:1, price:0 },
      { desc:"Glass shower door install (completed by a trusted sub contractor)", kind:"labor", qty:1, price:0 }];
    e.flatPrice = 8500;
    e.lead = { name:"Deanna", phone:"780-555-0101", city:"Edmonton" };
    Store.save(); return e.id;
  });
  await pg.evaluate(i => openEstimate(i), id); await pg.waitForTimeout(600);
  await pg.evaluate(() => { const el = document.querySelector('#est-flat'); if (el) el.scrollIntoView({block:'center'}); });
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: process.env.SP + '/flat-editor.png' });
  await pg.evaluate(() => closeModal());
  await pg.evaluate(i => { $('#print-area').innerHTML = estimateDocHtml(Store.estimate(i));
    $('#print-area').style.cssText = 'display:block;background:#fff;padding:30px'; }, id);
  await pg.waitForTimeout(400);
  await pg.locator('#print-area').screenshot({ path: process.env.SP + '/flat-doc.png' });
  await b.close(); console.log('done');
})();
