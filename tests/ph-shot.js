/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const pg = await b.newPage({ viewport:{width:430,height:950}, deviceScaleFactor:2 });
  pg.on('pageerror',e=>console.log('PAGEERROR '+e.message));
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(500);
  await pg.evaluate(async () => {
    const mk = (label, c1, c2) => new Promise(res => {
      const cv = document.createElement('canvas'); cv.width = 1600; cv.height = 1200;
      const g = cv.getContext('2d');
      const grad = g.createLinearGradient(0,0,1600,1200);
      grad.addColorStop(0,c1); grad.addColorStop(1,c2);
      g.fillStyle = grad; g.fillRect(0,0,1600,1200);
      g.fillStyle = 'rgba(255,255,255,.9)'; g.font='bold 150px sans-serif';
      g.textAlign='center'; g.fillText(label, 800, 660);
      cv.toBlob(x => res(new File([x],'p.jpg',{type:'image/jpeg'})),'image/jpeg',.9);
    });
    const j = Store.data.jobs.find(x => isOpen(x));
    await takePhotos('job', j.id, [
      await mk('BEFORE','#6b4423','#2b1a10'),
      await mk('AFTER','#1f6f4a','#0d3122'),
      await mk('PLATE','#2a4b6b','#101f2c'),
      await mk('VALVE','#5a2b3d','#241019')
    ]);
    const ps = Store.photosOf(Store.job(j.id));
    Store.setPhoto('job', j.id, ps[0].id, { tag:'before' });
    Store.setPhoto('job', j.id, ps[1].id, { tag:'after' });
    openJob(j.id);
  });
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => {
    const el = [...document.querySelectorAll('.section-title')].find(x => /Photos/.test(x.textContent));
    if (el) el.scrollIntoView({ block:'start' });
  });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: process.env.SP+'/shots/ph-panel.png' });
  console.log('shot done');
  await b.close();
})();
