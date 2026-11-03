/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const pg = await b.newPage({ viewport:{width:430,height:930}, deviceScaleFactor:2 });
  pg.on('pageerror',e=>console.log('PAGEERROR '+e.message));
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(500);
  await pg.evaluate(() => {
    const j = Store.data.jobs.find(x => isOpen(x));
    ['Expansion tank, 2 gal','3/4 sharkbite coupling','Braided supply 20in',
     'Wax ring kit','PEX 1/2in — 20ft'].forEach(t => Store.addMaterial('job', j.id, t, 1));
    const l = Store.materialsOf(j);
    Store.setMaterial('job', j.id, l[0].id, { got:true, cost:68 });
    Store.setMaterial('job', j.id, l[1].id, { cost:12.5 });
    l[2].from = 'estimate';
    const other = Store.data.jobs.filter(x => isOpen(x))[1];
    Store.addMaterial('job', other.id, 'Boiler circulator', 1);
    Store.addMaterial('job', other.id, 'Isolation flanges', 2);
    Store.save(); go('pickup');
  });
  await pg.waitForTimeout(450);
  await pg.screenshot({ path: process.env.SP+'/shots/mat-pickup.png', fullPage:true });
  await pg.evaluate(() => openJob(Store.data.jobs.find(x => isOpen(x)).id));
  await pg.waitForTimeout(450);
  const box = await pg.evaluate(() => {
    const el = [...document.querySelectorAll('.section-title')].find(x => /Materials/.test(x.textContent));
    el.scrollIntoView({block:'start'});
    return true;
  });
  await pg.waitForTimeout(350);
  await pg.screenshot({ path: process.env.SP+'/shots/mat-panel.png' });
  console.log('shots done');
  await b.close();
})();
