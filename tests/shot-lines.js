/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const pg = await b.newPage({ viewport:{width:1100,height:900}, deviceScaleFactor:2 });
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(500);
  const id = await pg.evaluate(() => {
    const e = Store.data.estimates.find(x => (x.items||[]).length);
    e.status="draft"; delete e.approval;
    e.items = [
      { desc:"Remove and dispose of old shower base, glass doors, and necessary walls, shower control valve.", kind:"labor", qty:1, price:1850 },
      { desc:"Plumb & install new shower pan, valve and glass", kind:"labor", qty:1, price:2400 },
      { desc:"Delta pressure-balance valve", kind:"part", qty:1, price:289 }];
    Store.save(); return e.id;
  });
  await pg.evaluate(i => openEstimate(i), id); await pg.waitForTimeout(600);
  await pg.evaluate(() => {
    const el = document.querySelector('[data-line-edit$=":0:desc"]');
    if (el) el.scrollIntoView({ block:'center' });
  });
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: process.env.SP + '/lines.png' });
  await b.close(); console.log('done');
})();
