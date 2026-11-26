/* The Sub tag, added up across jobs.

   He tags lines Sub so he can see what subcontracted work comes to. The tag
   already carried from an estimate onto its job, and each job showed its
   own "Lines by kind" — but no screen added it up across jobs, so tagging
   fifty lines would have bought him nothing he could read. Time & Money
   now has "Billed, by kind" over the same finished jobs as the rest of the
   page, adding up to exactly what was billed, with the Sub jobs listed.

   Invented jobs. Not tagged stays "Not tagged", never folded into Labor;
   a flat job's price stands on its own, never guessed into a kind.      */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP=`file://${REPO_DIR}/index.html`, errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1280,height:1000} });
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await pg.goto(APP); await pg.waitForTimeout(500);
  await pg.evaluate(()=>localStorage.clear()); await pg.reload(); await pg.waitForTimeout(400);

  // Only our three jobs are finished, so the sums are knowable.
  const ids = await pg.evaluate(() => {
    Store.data.jobs.forEach(j => { if (j.status === 'complete') j.status = 'scheduled'; });
    const base = Store.data.jobs[0], today = todayStr();
    const mk = (over) => { const j = Object.assign(JSON.parse(JSON.stringify(base)), { id: uid('job'), no: Store.nextJobNo(),
      status:'complete', scheduledDate: today, laborHours: 0, laborRate: 100, flatPrice: null, billWith: null, timeEntries: [] }, over);
      Store.data.jobs.push(j); return j; };
    const a = mk({ description:'tagged', laborHours: 2, parts: [
      { desc:'Excavation by the sub', kind:'sub', qty:1, price:1200 },
      { desc:'Ball valve', kind:'part', qty:2, price:45.50 } ] });
    const c = mk({ description:'old, untagged', parts: [ { desc:'Trap and labour', qty:1, price:180 } ] });
    const f = mk({ description:'flat', flatPrice: 2800, parts: [
      { desc:'Swap the tank', kind:'flat', qty:1, price:0 },
      { desc:'Hydro-vac locate', kind:'sub', qty:1, price:350 } ] });
    Store.save(); App.moneyRange = 30; go('timemoney'); render();
    return { a: a.id, c: c.id, f: f.id };
  });
  const row = k => pg.evaluate(k => { const r = document.querySelector(`[data-kind-row="${k}"]`); return r ? r.innerText.replace(/\s+/g,' ') : ''; }, k);

  await t('Sub adds up across jobs: $1,200 on one, $350 on the flat one', async () => {
    const r = await row('sub');
    if (!/Sub\s+2\s+\$1,550\.00/.test(r)) throw new Error('Sub row: ' + r);
  });
  await t('billed hours count as Labor, parts as Material / Parts', async () => {
    if (!/Labor\s+1\s+\$200\.00/.test(await row('labor'))) throw new Error(await row('labor'));
    if (!/Material \/ Parts\s+1\s+\$91\.00/.test(await row('part'))) throw new Error(await row('part'));
  });
  await t('an untagged line reads "Not tagged" — it is not guessed into Labor', async () => {
    if (!/Not tagged\s+1\s+\$180\.00/.test(await row('none'))) throw new Error(await row('none'));
  });
  await t('a flat job\'s price stands on its own, not put into any kind', async () => {
    if (!/Flat price for the whole job\s+1\s+\$2,800\.00/.test(await row('__flatprice'))) throw new Error(await row('__flatprice'));
    if (await row('flat')) throw new Error('a $0 scope line showed up: ' + await row('flat'));
  });
  await t('the kinds add up to exactly what those jobs billed', async () => {
    const billed = await pg.evaluate(i => [i.a, i.c, i.f].reduce((s, id) => s + Store.jobTotal(Store.job(id)), 0), ids);
    const tot = await pg.$eval('.kind-report tbody tr:last-child', r => r.innerText.replace(/\s+/g,' '));
    const shown = Number(tot.replace(/[^0-9.]/g, ''));
    if (Math.abs(shown - billed) > 0.004 || Math.abs(billed - 4821) > 0.004) throw new Error(`shown ${tot}, billed ${billed}`);
  });
  await t('the jobs with Sub lines are listed, and tapping one opens it', async () => {
    const n = await pg.$$eval('#view tr[data-job]', rs => rs.length);
    if (n !== 2) throw new Error(n + ' listed');
    await pg.click(`#view tr[data-job="${ids.a}"]`); await pg.waitForTimeout(300);
    const m = await pg.$eval('#modal-root .modal', e => e.innerText);
    if (!/Excavation by the sub/.test(m)) throw new Error('opened the wrong thing');
  });
  await t('it says plainly that Sub is what you charged, not what you paid', async () => {
    const txt = await pg.evaluate(() => document.querySelector('#view').innerText);
    if (!/what you charged, not what\s+you paid the sub/.test(txt)) throw new Error('no caveat');
  });
  await t('jobs not finished, or outside the window, are left out', async () => {
    await pg.evaluate(i => { closeModal(); Store.job(i.a).scheduledDate = addDays(todayStr(), -60); Store.save(); render(); }, ids);
    if (!/Sub\s+1\s+\$350\.00/.test(await row('sub'))) throw new Error(await row('sub'));
    if (await row('labor')) throw new Error('old job still counted');
  });

  await b.close();
  const hard = errs.filter(e=>/CONSOLE|PAGEERROR/.test(e));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
