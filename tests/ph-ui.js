/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const pg = await b.newPage({ viewport:{width:430,height:930} });
  const logs=[];
  pg.on('pageerror',e=>logs.push('PAGEERROR '+e.message));
  pg.on('console',m=>logs.push(m.type()+': '+m.text()));
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(500);

  const jobId = await pg.evaluate(() => { const j = Store.data.jobs.find(x=>isOpen(x)); openJob(j.id); return j.id; });
  await pg.waitForTimeout(500);

  // what the markup actually looks like
  const markup = await pg.evaluate(() => {
    const inp = document.querySelector('[data-ph-file]');
    if (!inp) return { none: true };
    const cs = getComputedStyle(inp);
    return { hidden: inp.hidden, display: cs.display, visibility: cs.visibility,
             parentTag: inp.parentElement.tagName, parentClass: inp.parentElement.className,
             attrs: inp.getAttributeNames().join(',') };
  });
  console.log('input:', JSON.stringify(markup));

  // the real path: set files on the input, which fires change exactly as the picker would
  const before = await pg.evaluate(id => Store.photosOf(Store.job(id)).length, jobId);
  await pg.setInputFiles('[data-ph-file]', process.env.SP + '/testphoto.jpg');
  await pg.waitForTimeout(1500);
  const after = await pg.evaluate(id => Store.photosOf(Store.job(id)).length, jobId);
  console.log('photos: ' + before + ' -> ' + after, after > before ? 'WORKS' : '*** NOTHING HAPPENED ***');

  // does a click on the label reach the input at all?
  const clicked = await pg.evaluate(() => {
    let fired = false;
    const inp = document.querySelector('[data-ph-file]');
    inp.addEventListener('click', () => { fired = true; }, { once:true });
    document.querySelector('.ph-take').click();
    return fired;
  });
  console.log('label click reaches the input:', clicked);

  console.log('--- console ---');
  logs.slice(-12).forEach(l => console.log('  ' + l));
  await b.close();
})();
