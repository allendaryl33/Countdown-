/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it if the app lives elsewhere. */
const APP = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const pg = await b.newPage({ viewport:{width:1500,height:900}, deviceScaleFactor:2, colorScheme:'dark' });
  await pg.goto(`file://${APP}/index.html`); await pg.waitForTimeout(500);
  await pg.evaluate(() => {
    Store.data.techs = Store.data.techs.slice(0,1); Store.data.techs[0].name = "Daryl";
    App.view="schedule"; App.scheduleMode="week"; App.date=todayStr(); render();
  });
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: process.env.SP + '/week-dark.png' });
  await b.close(); console.log('done');
})();
