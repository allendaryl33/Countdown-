/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it if the app lives elsewhere. */
const APP = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const probe = async (label, file, vp) => {
    const pg = await b.newPage({ viewport: vp });
    await pg.goto('file://' + file); await pg.waitForTimeout(400);
    await pg.evaluate(() => go('pricebook')); await pg.waitForTimeout(400);
    const m = await pg.evaluate(() => {
      const el = document.scrollingElement;
      const app = document.getElementById('app');
      const view = document.getElementById('view');
      const rows = [...document.querySelectorAll('tbody tr')];
      const last = rows[rows.length-1];
      const r = last ? last.getBoundingClientRect() : null;
      return {
        docScroll: el.scrollHeight, docClient: el.clientHeight,
        bodyH: document.body.getBoundingClientRect().height,
        bodyOverflowY: getComputedStyle(document.body).overflowY,
        htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
        appH: app.getBoundingClientRect().height,
        viewH: view.getBoundingClientRect().height,
        viewScroll: view.scrollHeight,
        rows: rows.length,
        lastRowText: last ? last.textContent.trim().slice(0,40) : null,
        lastRowBottom: r ? Math.round(r.bottom) : null
      };
    });
    // can we actually scroll to the bottom?
    await pg.evaluate(() => document.scrollingElement.scrollTo(0, 99999));
    await pg.waitForTimeout(250);
    const after = await pg.evaluate(() => {
      const rows = [...document.querySelectorAll('tbody tr')];
      const last = rows[rows.length-1];
      return { scrollTop: Math.round(document.scrollingElement.scrollTop),
               lastVisible: last ? Math.round(last.getBoundingClientRect().bottom) <= window.innerHeight + 2 : null,
               lastText: last ? last.textContent.trim().slice(0,40) : null };
    });
    console.log(label, JSON.stringify({...m, ...after}, null, 1));
    await pg.screenshot({ path: process.env.SP + '/shots/pb-' + label + '.png', fullPage:false });
    await pg.close();
  };
  await probe('local-desktop', `${APP}/index.html`, {width:1400,height:900});
  await probe('local-phone',   `${APP}/index.html`, {width:390,height:844});
  await probe('artifact-phone', process.env.SP + '/pcp-dispatch.html', {width:390,height:844});
  await b.close();
})();
