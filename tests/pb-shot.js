const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const pg = await b.newPage({ viewport:{width:430,height:900}, deviceScaleFactor:2 });
  pg.on('pageerror',e=>console.log('PAGEERROR '+e.message));
  await pg.goto('file://' + process.env.SP + '/pcp-dispatch.html'); await pg.waitForTimeout(400);
  await pg.evaluate(() => go('pricebook')); await pg.waitForTimeout(400);
  await pg.screenshot({ path: process.env.SP + '/shots/pb-full.png', fullPage:true });
  const n = await pg.$$eval('tbody tr', r=>r.length);
  const sections = await pg.$$eval('.section-title', s=>s.map(x=>x.textContent));
  console.log('rows', n, 'sections', JSON.stringify(sections));
  await b.close();
})();
