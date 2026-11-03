/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const pg = await b.newPage({ viewport:{width:1500,height:1000}, deviceScaleFactor:2 });
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(500);
  await pg.evaluate(() => {
    // one tech, the way he actually runs it
    Store.data.techs = Store.data.techs.slice(0,1);
    Store.data.techs[0].name = "Daryl";
    const d = todayStr(), t = Store.data.techs[0].id;
    const plan = [[0,0,"8:00–10:00",t],[1,0,"2:00–4:00",t],[2,1,"10:00–12:00",t],
                  [3,1,"ASAP / Emergency",null],[4,2,"Anytime",null],[5,3,"12:00–2:00",t]];
    plan.forEach(([i,off,w,tech]) => {
      const j = Store.data.jobs[i]; if (!j) return;
      j.scheduledDate = addDays(d, off); j.window = w; Store.assign(j, tech);
    });
    Store.save(); App.view="schedule"; App.scheduleMode="week"; App.date=d; render();
  });
  await pg.waitForTimeout(700);
  await pg.screenshot({ path: process.env.SP + '/week-wide.png', fullPage:true });
  await b.close(); console.log('shot done');
})();
