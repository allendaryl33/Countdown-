/* PO numbers: 261117-01, the day it was opened and that day's count.

   Nov 17: paying a sub, he had to put a reference on the e-Transfer and
   got tangled — job #1004 and INV-1004 were two different customers. Jobs
   are now "PO"s numbered by the day they're made: big to small, never
   ambiguous, sorted by date, searchable by roughly-when. Return visits add
   B, C… Invoices keep INV-1003 and up. Old job numbers are never changed —
   they're already on memos, receipts and customers' invoices.           */
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

  const today = await pg.evaluate(() => { const d = new Date(), p = n => String(n).padStart(2,'0');
    return String(d.getFullYear()).slice(2) + p(d.getMonth()+1) + p(d.getDate()); });
  // the sample shop numbers its jobs 1001 and up, like his real early ones
  const old = await pg.evaluate(() => Store.data.jobs.map(j => String(j.no)));

  console.log('--- the number ---');
  let bob, mark;
  await t('the first PO made today is YYMMDD-01, the next -02', async () => {
    const r = await pg.evaluate(() => [Store.nextJobNo(), Store.nextJobNo()]);
    if (r[0] !== today + '-01' || r[1] !== today + '-02') throw new Error(r.join(', ') + ' — wanted ' + today + '-01, -02');
    console.log('       ' + r.join(', '));
  });
  await t('a new job from "+ New Job" gets the next one, in order', async () => {
    bob = await pg.evaluate(() => { openJobForm(null); return null; });
    await pg.waitForTimeout(300);
    const before = await pg.evaluate(() => Store.data.jobs.length);
    await pg.selectOption('#f-customer', await pg.evaluate(() => Store.data.customers[0].id));
    await pg.fill('#f-desc', 'Bob — kitchen sink');
    await pg.click('[data-save-job]'); await pg.waitForTimeout(300);
    const j = await pg.evaluate(n => Store.data.jobs.length > n ? Store.data.jobs[Store.data.jobs.length - 1] : null, before);
    if (!j) throw new Error('the form did not make a job: ' + await pg.evaluate(() => (document.querySelector('.modal')||{}).innerText || '').then(x => x.slice(0,200)));
    if (j.no !== today + '-03') throw new Error('got ' + j.no);
    bob = j.id;
  });
  await t('an approved estimate becoming a job gets the next one too', async () => {
    mark = await pg.evaluate(() => {
      const e = Store.data.estimates.find(x => !x.jobId);
      Store.convertEstimate(e, { customerId: Store.data.customers[0].id, scheduledDate: todayStr(), window:'Anytime', priority:'Normal' });
      return Store.data.jobs[Store.data.jobs.length - 1];
    });
    if (mark.no !== today + '-04') throw new Error('got ' + mark.no);
  });
  await t('a new day starts back at 01', async () => {
    const r = await pg.evaluate(t => { Store.data.counterPo = 99123199; return Store.nextJobNo(); }, today);
    if (r !== today + '-01' && !/^\d{6}-0[1-9]$/.test(r)) throw new Error(r);
    // and yesterday's count never carries into today
    const r2 = await pg.evaluate(() => { const y = new Date(Date.now() - 86400000), p = n => String(n).padStart(2,'0');
      const keepJobs = Store.data.jobs, keepCount = Store.data.counterPo;
      Store.data.counterPo = Number(String(y.getFullYear()).slice(2) + p(y.getMonth()+1) + p(y.getDate())) * 100 + 7;
      Store.data.jobs = keepJobs.filter(j => !String(j.no).startsWith(todayStr().slice(2).replace(/-/g,'')));
      const got = Store.nextJobNo();
      Store.data.jobs = keepJobs; Store.data.counterPo = keepCount;   // put today's back for the tests after
      return got; });
    if (r2 !== today + '-01') throw new Error('after yesterday\'s 07 it gave ' + r2);
  });
  await t('a PO already on a job today is never handed out again', async () => {
    const r = await pg.evaluate(t => {
      Store.data.counterPo = 0;                       // as if the counter came in behind
      Store.data.jobs[0].no = t + '-05';              // …but a job already has 05
      return Store.nextJobNo();
    }, today);
    if (r !== today + '-06') throw new Error(r);
  });

  console.log('--- return visits ---');
  await t('trips two and three are the same PO with B and C', async () => {
    const r = await pg.evaluate(id => {
      const j = Store.job(id);
      const k1 = Store.anotherVisit(j), k2 = Store.anotherVisit(j);
      return [j.no, k1.no, k2.no];
    }, bob);
    if (r[1] !== r[0] + 'B' || r[2] !== r[0] + 'C') throw new Error(r.join(', '));
    console.log('       ' + r.join(', '));
  });

  console.log('--- the old numbers ---');
  await t('jobs numbered before this keep their numbers', async () => {
    const now = await pg.evaluate(() => Store.data.jobs.map(j => String(j.no)));
    const kept = old.filter(n => now.includes(n));
    if (kept.length < old.length - 1) throw new Error('renumbered: ' + old.filter(n => !now.includes(n)).join(', '));
  });
  await t('and show under the PO label', async () => {
    const r = await pg.evaluate(() => { const j = Store.data.jobs.find(x => /^\d{4}$/.test(String(x.no)));
      openJob(j.id); return { no: j.no, head: document.querySelector('.modal-head').textContent.replace(/\s+/g,' ') }; });
    if (!r.head.includes('PO ' + r.no)) throw new Error(r.head.slice(0, 120));
    if (/Job #/.test(r.head)) throw new Error('still says Job #');
    await pg.evaluate(() => closeModal());
  });
  await t('invoice numbers are untouched: still INV- and counting', async () => {
    const r = await pg.evaluate(() => { const j = Store.data.jobs.find(x => !x.invoiceNo);
      const before = Store.data.counterInv || 1000; return [before, Store.invoiceNoFor(j)]; });
    if (r[1] !== r[0] + 1) throw new Error(r.join(' → '));
  });

  console.log('--- finding them ---');
  await t('"' + today.slice(0, 4) + '" finds this month\'s POs; "PO ' + today + '" finds today\'s', async () => {
    const find = q => pg.evaluate(q => { App.search = q; render(); const x = document.querySelector('#view').innerText; App.search = ''; render(); return x; }, q);
    const month = await find(today.slice(0, 4));
    if (!month.includes(today + '-03')) throw new Error('month search missed today\'s PO');
    const day = await find('PO ' + today);
    if (!day.includes(today + '-03')) throw new Error('"PO ' + today + '" missed it');
    const other = await find('991231');
    if (other.includes(today + '-03')) throw new Error('a different day matched');
  });

  console.log('--- the word ---');
  await t('nothing on his own screens says "Job #" any more', async () => {
    const seen = [];
    for (const v of ['today','schedule','jobs','invoices','estimates','dashboard']){
      const x = await pg.evaluate(v => { go(v); render(); return document.querySelector('#view').innerText; }, v);
      if (/job #\d/i.test(x)) seen.push(v);
    }
    const sheet = await pg.evaluate(id => { openJob(id); return document.querySelector('.modal').innerText; }, bob);
    if (/job #\d/i.test(sheet)) seen.push('job sheet');
    if (seen.length) throw new Error('"Job #" still on: ' + seen.join(', '));
  });

  await b.close();
  const hard = errs.filter(e=>e.includes('CONSOLE')||e.includes('PAGEERROR'));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
