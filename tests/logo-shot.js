/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const errs=[];
  const pg = await b.newPage({ viewport:{width:1300,height:900}, deviceScaleFactor:2 });
  pg.on('pageerror',e=>errs.push(e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(600);

  const mark = await pg.evaluate(() => {
    const el = document.querySelector('.brand .logo');
    const bg = getComputedStyle(el).backgroundImage;
    return { inlined: bg.startsWith('url("data:image/png;base64,'), text: el.textContent.trim(),
             size: getComputedStyle(el).width };
  });
  console.log('sidebar mark:', JSON.stringify(mark));
  await pg.screenshot({ path: process.env.SP+'/shots/logo-sidebar.png', clip:{x:0,y:0,width:290,height:130} });

  await pg.evaluate(() => printJobs([Store.data.jobs[0]], 'x'));
  await pg.waitForTimeout(300);
  await pg.emulateMedia({ media:'print' });
  await pg.waitForTimeout(300);
  const doc = await pg.evaluate(() => {
    const el = document.querySelector('.doc-logo');
    const bg = getComputedStyle(el).backgroundImage;
    const r = el.getBoundingClientRect();
    return { inlined: bg.startsWith('url("data:image/png;base64,'),
             w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.log('printed badge:', JSON.stringify(doc));
  await pg.screenshot({ path: process.env.SP+'/shots/logo-ticket.png', clip:{x:0,y:0,width:950,height:300} });
  await pg.emulateMedia({ media:'screen' });
  console.log('errors:', errs.join('|') || 'none');
  await b.close();
})();
