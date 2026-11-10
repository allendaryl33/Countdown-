/* "Are you sure?" asked inside the app, where anyone can answer it.

   Nov 9: the assistant that does most of his data entry tried "Delete job"
   five times and "Delete estimate" twice and nothing happened — no
   dialog, no error. The app was fine: it asked with the browser's own
   confirm(), which sits outside the page, and that tool answers such
   pop-ups No without showing them. So the question is now a box in the
   page with the same words, Cancel and Delete. He taps it the same way.

   These tests make the browser's own pop-up fail the test if it ever
   appears again, then answer the in-app box both ways.                  */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP=`file://${REPO_DIR}/index.html`, errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1280,height:1000} });
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  // Any browser pop-up at all is the old behaviour coming back.
  pg.on('dialog', d => { errs.push('BROWSER POP-UP: ' + d.message().split('\n')[0]); d.dismiss(); });
  await pg.goto(APP); await pg.waitForTimeout(500);
  await pg.evaluate(()=>localStorage.clear()); await pg.reload(); await pg.waitForTimeout(400);

  const counts = () => pg.evaluate(() => ({ j: Store.data.jobs.length, e: Store.data.estimates.length }));
  const ask = () => pg.evaluate(() => { const r = document.querySelector('#ask-root .ask'); return r ? r.textContent.replace(/\s+/g,' ').trim() : ''; });

  console.log('--- deleting a job ---');
  let jid, before;
  await t('Delete job asks in the app, in plain words, with Cancel and Delete job', async () => {
    before = await counts();
    jid = await pg.evaluate(() => { const j = Store.data.jobs[0]; openJob(j.id); return j.id; }); await pg.waitForTimeout(300);
    await pg.click('[data-del-job]'); await pg.waitForTimeout(200);
    const q = await ask();
    if (!/Delete job #\d+ for .+\?/.test(q) || !/cannot be undone/.test(q)) throw new Error('asked: '+q);
    const btns = await pg.$$eval('#ask-root [data-ask]', bs => bs.map(x => x.textContent.trim()));
    if (btns.join('|') !== 'Cancel|Delete job') throw new Error(btns.join('|'));
    const focus = await pg.evaluate(() => document.activeElement && document.activeElement.dataset.ask);
    if (focus !== 'no') throw new Error('focus is on '+focus+' — a stray Enter should be the safe answer');
  });
  await t('Cancel leaves the job, and the job sheet is still open behind it', async () => {
    await pg.click('#ask-root [data-ask="no"]'); await pg.waitForTimeout(200);
    if ((await counts()).j !== before.j) throw new Error('deleted on Cancel');
    if (await ask()) throw new Error('box still up');
    if (!await pg.$('#modal-root [data-del-job]')) throw new Error('the job sheet went too');
  });
  await t('Escape cancels the question without closing the sheet under it', async () => {
    await pg.click('[data-del-job]'); await pg.waitForTimeout(200);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
    if (await ask()) throw new Error('box still up');
    if (!await pg.$('#modal-root [data-del-job]')) throw new Error('Escape closed the job sheet as well');
    if ((await counts()).j !== before.j) throw new Error('deleted on Escape');
  });
  await t('Delete job deletes it — once, and nothing else', async () => {
    await pg.click('[data-del-job]'); await pg.waitForTimeout(200);
    await pg.click('#ask-root [data-ask="yes"]'); await pg.waitForTimeout(300);
    const now = await counts();
    if (now.j !== before.j - 1) throw new Error('jobs '+before.j+' → '+now.j);
    if (now.e !== before.e) throw new Error('an estimate went too');
    if (await pg.evaluate(id => !!Store.job(id), jid)) throw new Error('that job is still there');
    if (await ask()) throw new Error('it asked again');
  });

  console.log('--- deleting an estimate and an option ---');
  await t('Delete estimate deletes it after a yes, and not before', async () => {
    const b4 = await counts();
    const eid = await pg.evaluate(() => { const e = Store.data.estimates[0]; delete e.options; Store.save(); closeModal(); openEstimate(e.id); return e.id; });
    await pg.waitForTimeout(300);
    await pg.click('[data-del-estimate]'); await pg.waitForTimeout(200);
    if ((await counts()).e !== b4.e) throw new Error('gone before the answer');
    if (!/Delete estimate EST-\d+/.test(await ask())) throw new Error('asked: '+await ask());
    await pg.click('#ask-root [data-ask="yes"]'); await pg.waitForTimeout(300);
    if ((await counts()).e !== b4.e - 1) throw new Error('not deleted');
    if (await pg.evaluate(id => !!Store.estimate(id), eid)) throw new Error('still there');
  });
  await t('the × on an option removes that option after a yes', async () => {
    const eid = await pg.evaluate(() => { const e = Store.data.estimates[0]; delete e.options; Store.save(); closeModal(); openEstimate(e.id); return e.id; });
    await pg.waitForTimeout(300);
    await pg.click('[data-opt-add]'); await pg.waitForTimeout(250);
    await pg.click('[data-opt-add]'); await pg.waitForTimeout(250);
    const n = await pg.evaluate(i => Store.estimate(i).options.length, eid);
    await pg.click('[data-opt-drop]'); await pg.waitForTimeout(200);
    if (!/^Remove /.test(await ask())) throw new Error('asked: '+await ask());
    await pg.click('#ask-root [data-ask="yes"]'); await pg.waitForTimeout(300);
    const m = await pg.evaluate(i => (Store.estimate(i).options || []).length, eid);
    if (m !== n - 1) throw new Error('options '+n+' → '+m);
  });

  console.log('--- the smaller ones ---');
  await t('removing a time entry asks in the app too', async () => {
    const id = await pg.evaluate(() => { const j = Store.data.jobs[0];
      Store.addEntry('job', j.id, Date.now()-3600000, Date.now(), ''); closeModal(); openJob(j.id); return j.id; });
    await pg.waitForTimeout(300);
    const b4 = await pg.evaluate(i => Store.entriesOf(Store.job(i)).length, id);
    await pg.click('.modal [data-del-time]'); await pg.waitForTimeout(200);
    if (!/Remove this time entry\?/.test(await ask())) throw new Error('asked: '+await ask());
    await pg.click('#ask-root [data-ask="yes"]'); await pg.waitForTimeout(300);
    const af = await pg.evaluate(i => Store.entriesOf(Store.job(i)).length, id);
    if (af !== b4 - 1) throw new Error(b4+' → '+af);
  });
  await t('removing a price-book item asks in the app, and Cancel keeps it', async () => {
    await pg.evaluate(() => { closeModal(); go('pricebook'); render(); }); await pg.waitForTimeout(300);
    const b4 = await pg.evaluate(() => Store.data.priceBook.length);
    await pg.click('[data-del-price]'); await pg.waitForTimeout(200);
    if (!/from the price book\?/.test(await ask())) throw new Error('asked: '+await ask());
    await pg.click('#ask-root [data-ask="no"]'); await pg.waitForTimeout(200);
    if (await pg.evaluate(() => Store.data.priceBook.length) !== b4) throw new Error('removed on Cancel');
  });
  await t('nothing in the app calls the browser\'s own confirm() any more', async () => {
    const src = require('fs').readFileSync(`${REPO_DIR}/index.html`, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const left = (src.match(/[^.\w]confirm\(/g) || []).length;
    if (left) throw new Error(left + ' call(s) to confirm() left');
  });

  await b.close();
  const hard = errs.filter(e=>/CONSOLE|PAGEERROR|POP-UP/.test(e));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
