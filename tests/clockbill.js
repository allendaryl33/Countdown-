/* The clock and the bill are two different numbers.

   He worked twelve hours on Deanna's job, clocked in and out, saw the app
   confirm twelve hours, and the job billed zero. Nothing failed. Nothing
   errored. The clock records how long he was there; laborHours is what the
   customer pays for; and nothing has ever copied one into the other.

   Worse than the missing hours: invToSend only lists finished work worth
   something, so a job with twelve clocked hours and no billable hours is
   worth nothing, falls out of every list, and is never asked about again.
   He would simply never invoice it.

   These tests are about saying so out loud. Nothing here writes his hours
   for him — guessing what he meant to charge is how records get rewritten
   behind his back — but he cannot miss that the two disagree. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1400,height:950} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error' && !/Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  /* Deanna's job, as it actually was: twelve hours clocked, nothing billed. */
  const jid = await pg.evaluate(() => {
    const j = Store.data.jobs[0];
    const end = Date.now() - 3600000;
    Object.assign(j, {
      status: "complete", payment: null, flatPrice: null, billWith: null,
      laborHours: 0, laborRate: 145, parts: [], materialCost: 0,
      timeEntries: [{ id: uid("te"), startedAt: end - 12*3600000, endedAt: end, note: "" }]
    });
    Store.save(); return j.id;
  });
  const job = () => pg.evaluate(i => Store.job(i), jid);
  const open = async () => { await pg.evaluate(i => openJob(i), jid); await pg.waitForTimeout(400); };
  const panel = () => pg.evaluate(() => (document.querySelector('#modal-root')||{}).innerText || '');

  await t('this is the shape of the bug: twelve hours on, zero billed', async () => {
    const r = await pg.evaluate(i => {
      const j = Store.job(i);
      return { clocked: hoursOf(Store.totalMs(j)), billed: j.laborHours, worth: Store.jobTotal(j) };
    }, jid);
    if (Math.round(r.clocked) !== 12) throw new Error('setup: clocked is ' + r.clocked);
    if (r.billed !== 0) throw new Error('setup: billed is ' + r.billed);
    if (r.worth !== 0) throw new Error('setup: the job is worth ' + r.worth);
  });

  await t('and it falls out of the invoice list entirely, which is the real harm', async () => {
    const r = await pg.evaluate(i => ({
      toSend: Store.invToSend().some(j => j.id === i),
      toBill: Store.toInvoice().some(j => j.id === i)
    }), jid);
    if (r.toSend) throw new Error('it is in invToSend, so this test proves nothing');
    // toInvoice has no money filter, so it does still appear there
    if (!r.toBill) throw new Error('setup changed: it is not in toInvoice either');
  });

  await t('the job says so, in words, before he invoices it', async () => {
    await open();
    const p = await panel();
    if (!/12 hours on the clock/i.test(p))
      throw new Error('the panel does not mention the clock: ' + p.slice(0,300));
    if (!/0 on the bill/i.test(p))
      throw new Error('it does not say what is actually billed: ' + p.slice(0,300));
  });

  await t('and offers to close the gap in one tap, without doing it by itself', async () => {
    const before = (await job()).laborHours;
    if (before !== 0) throw new Error('something wrote his hours for him: ' + before);
    const there = await pg.evaluate(() => !!document.querySelector('[data-use-clock]'));
    if (!there) throw new Error('no way to accept the clocked hours');
    await pg.click('[data-use-clock]'); await pg.waitForTimeout(450);
    const j = await job();
    if (j.laborHours !== 12) throw new Error('billed hours are ' + j.laborHours);
  });

  await t('which puts it back in the invoice list, worth what he worked', async () => {
    const r = await pg.evaluate(i => ({
      worth: Store.jobTotal(Store.job(i)),
      listed: Store.invToSend().some(j => j.id === i)
    }), jid);
    if (r.worth !== 12 * 145) throw new Error('the job is worth ' + r.worth);
    if (!r.listed) throw new Error('still not in the invoice list');
  });

  await t('the warning goes once the two agree', async () => {
    await open();
    const p = await panel();
    if (/on the clock, but/i.test(p)) throw new Error('still warning when they match');
  });

  await t('it writes down what it changed, and from what', async () => {
    const log = await pg.evaluate(i => (Store.job(i).log||[]).map(l=>l.text||l).join(' | '), jid);
    if (!/Billable hours set to 12 from the clock \(was 0\)/.test(log))
      throw new Error('the change is not in the log: ' + log);
  });

  await t('he can say they are meant to differ, and it stops asking', async () => {
    await pg.evaluate(i => { Store.job(i).laborHours = 4; Store.save(); }, jid);
    await open();
    let p = await panel();
    if (!/on the clock, but/i.test(p)) throw new Error('it should be warning at 4 vs 12');
    await pg.click('[data-ignore-clock]'); await pg.waitForTimeout(450);
    p = await panel();
    if (/on the clock, but/i.test(p)) throw new Error('it kept asking after he said no');
    const log = await pg.evaluate(i => (Store.job(i).log||[]).map(l=>l.text||l).join(' | '), jid);
    if (!/meant to differ/i.test(log)) throw new Error('his answer was not written down');
  });

  await t('but it asks again once the clock has moved on', async () => {
    await pg.evaluate(i => {
      const j = Store.job(i);
      const end = Date.now();
      j.timeEntries.push({ id: uid("te"), startedAt: end - 2*3600000, endedAt: end, note:"" });
      Store.save();
    }, jid);
    await open();
    const p = await panel();
    if (!/on the clock, but/i.test(p))
      throw new Error('two more hours went by and it stayed quiet: ' + p.slice(0,200));
  });

  await t('a flat-price job is never nagged, because hours are not what it bills', async () => {
    const warned = await pg.evaluate(i => {
      const j = Store.job(i);
      j.flatPrice = 5000; j.laborHours = 0; delete j.clockOkAt; Store.save();
      openJob(i);
      return (document.querySelector('#modal-root')||{}).innerText || '';
    }, jid);
    await pg.waitForTimeout(300);
    if (/on the clock, but/i.test(warned))
      throw new Error('it nagged about hours on a job quoted as one price');
  });

  await t('the money screen names finished work that would otherwise vanish', async () => {
    await pg.evaluate(i => {
      const j = Store.job(i);
      j.flatPrice = null; j.laborHours = 0; delete j.clockOkAt;
      j.status = "complete"; j.payment = null; Store.save();
      closeModal(); go("invoices"); render();
    }, jid);
    await pg.waitForTimeout(450);
    const r = await pg.evaluate(i => {
      const w = document.querySelector('.clockwarn');
      return { text: w ? w.innerText : null,
               link: !!document.querySelector(`.clockwarn [data-job="${i}"]`) };
    }, jid);
    if (!r.text) throw new Error('nothing on the money screen about it');
    if (!/nothing to bill/i.test(r.text)) throw new Error('got: ' + r.text);
    if (!r.link) throw new Error('no way to get to the job from there');
  });

  await b.close();
  if (errs.length){
    console.log('\n' + errs.length + ' problem(s)');
    errs.forEach(e => console.log('  - ' + e));
    process.exit(1);
  }
  console.log('\nall good');
})();
