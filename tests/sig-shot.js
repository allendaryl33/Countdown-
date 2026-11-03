/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it if the app lives elsewhere. */
const APP = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const pg = await b.newPage({ viewport:{width:1100,height:1400} });
  await pg.goto(`file://${APP}/index.html`); await pg.waitForTimeout(450);
  const jid = await pg.evaluate(() => {
    Object.assign(Store.data.settings, { gst:'123456789 RT0001', gstRate:5 });
    const j = Store.data.jobs.find(x => x.customerId && (x.parts||[]).length) || Store.data.jobs[0];
    j.laborHours = 2; j.laborRate = 145; j.status='complete'; Store.save(); return j.id;
  });
  await pg.evaluate(id => openWaiverSign(Store.activeTemplates()[0].id, id), jid);
  await pg.waitForTimeout(600);
  const pad = await pg.$('#sigpad'); await pad.scrollIntoViewIfNeeded(); await pg.waitForTimeout(250);
  const box = await pad.boundingBox();
  await pg.$$eval('.wv-ack', bs => bs.forEach(b => { if (!b.checked) b.click(); }));
  await pg.fill('#wv-name', 'Dave Broadfoot');
  await pg.mouse.move(box.x+40, box.y+box.height*0.62); await pg.mouse.down();
  for (let i=1;i<=22;i++) await pg.mouse.move(box.x+40+i*9, box.y+box.height*(0.62-Math.sin(i/2.2)*0.26));
  await pg.mouse.up(); await pg.mouse.move(5,5); await pg.waitForTimeout(250);
  await pg.evaluate(() => document.querySelector('[data-sign-waiver]').click());
  await pg.waitForTimeout(800);
  await pg.evaluate(() => closeModal());
  await pg.evaluate(id => previewInvoice(id), jid); await pg.waitForTimeout(1200);
  const el = await pg.$('.inv-preview');
  await el.screenshot({ path: process.env.SP + '/shots/invoice-signed.png' });
  await b.close(); console.log('shot');
})();
