/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const pg = await b.newPage({ viewport:{width:430,height:900}, deviceScaleFactor:2 });
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(500);
  await pg.evaluate(() => {
    const d = todayStr(), techs = Store.activeTechs();
    const wins = ["8:00–10:00","10:00–12:00","2:00–4:00","ASAP / Emergency"];
    Store.data.jobs.slice(0,4).forEach((j,i) => {
      j.scheduledDate = d; j.window = wins[i];
      Store.assign(j, i === 3 ? null : techs[i % techs.length].id);
    });
    Store.save(); App.view="schedule"; App.mode="day"; App.date=d; render();
  });
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: process.env.SP + '/grid-phone.png', fullPage:true });
  await pg.setViewportSize({ width:1280, height:900 });
  await pg.evaluate(() => render()); await pg.waitForTimeout(500);
  await pg.screenshot({ path: process.env.SP + '/grid-wide.png', fullPage:true });
  await b.close(); console.log('shots done');
})();
