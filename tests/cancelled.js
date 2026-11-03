/* Cancelled work was still holding a slot on the board and still reading as
   money owed. A day has only so many slots, and "owed to you" is the one
   number on that screen that has to be true. */
/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it if the app lives elsewhere. */
const APP = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1280,height:1000} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${APP}/index.html`); await pg.waitForTimeout(450);

  const jid = await pg.evaluate(() => {
    const j = Store.data.jobs.find(x => Store.jobTotal(x) > 0);
    j.scheduledDate = todayStr(); j.status = "complete"; j.window = "10:00–12:00";
    Store.assign(j, Store.activeTechs()[0].id);
    Store.setPayment(j, { status:"invoiced", amountPaid: 0 });
    Store.save(); return j.id;
  });
  const owedNow = () => pg.evaluate(() =>
    Store.outstanding().reduce((s,j) => s + Store.balance(j), 0));
  const onBoard = (mode) => pg.evaluate(m => {
    App.view = "schedule"; App.scheduleMode = m; App.date = todayStr(); render();
    return document.querySelectorAll('.daygrid [data-job], .mo-cell [data-job]').length;
  }, mode);

  let owedBefore, dayBefore, weekBefore;
  await t('while it is live it is owed and it is on the board', async () => {
    owedBefore = await owedNow();
    if (!(owedBefore > 0)) throw new Error('nothing owed to begin with');
    dayBefore  = await onBoard("day");
    weekBefore = await onBoard("week");
    if (!dayBefore || !weekBefore) throw new Error('not on the board to begin with');
  });

  await t('cancelling takes it out of what he is owed', async () => {
    await pg.evaluate(id => { Store.job(id).status = "cancelled"; Store.save(); }, jid);
    const after = await owedNow();
    if (after >= owedBefore) throw new Error('still owed ' + after);
    const listed = await pg.evaluate(id => Store.outstanding().some(j => j.id === id), jid);
    if (listed) throw new Error('still in the outstanding list');
  });

  await t('and off the day board, so the slot is sellable again', async () => {
    const n = await onBoard("day");
    if (n >= dayBefore) throw new Error('still holding a slot (' + n + ')');
    const there = await pg.evaluate(id =>
      !!document.querySelector('.daygrid [data-job="'+id+'"]'), jid);
    if (there) throw new Error('the cancelled card is still in a square');
  });

  await t('and off the week', async () => {
    const there = await pg.evaluate(id => {
      App.scheduleMode = "week"; render();
      return !!document.querySelector('.weekhours [data-job="'+id+'"]');
    }, jid);
    await pg.waitForTimeout(250);
    if (there) throw new Error('still on the week grid');
  });

  await t('and off the month', async () => {
    const there = await pg.evaluate(id => {
      App.scheduleMode = "month"; render();
      return !!document.querySelector('.mo-cell [data-job="'+id+'"]');
    }, jid);
    await pg.waitForTimeout(250);
    if (there) throw new Error('still on the month grid');
  });

  await t('the count above the board matches what is drawn', async () => {
    const r = await pg.evaluate(() => {
      App.scheduleMode = "day"; render();
      const note = document.querySelector('.filter-note').textContent;
      const drawn = document.querySelectorAll('.daygrid [data-job]').length;
      return { said: Number((note.match(/(\d+)\s+job/) || [])[1]), drawn };
    });
    if (r.said !== r.drawn) throw new Error('says ' + r.said + ', draws ' + r.drawn);
  });

  await t('a cancelled job that was paid stops counting as collected', async () => {
    const r = await pg.evaluate(id => {
      const j = Store.job(id);
      j.status = "complete"; Store.setPayment(j, { status:"paid" });
      const before = Store.invPaid().length;
      j.status = "cancelled"; Store.save();
      return { before, after: Store.invPaid().length };
    }, jid);
    if (r.after !== r.before - 1) throw new Error('paid list went ' + r.before + ' → ' + r.after);
  });

  await t('un-cancelling puts the money and the slot back, nothing lost', async () => {
    const r = await pg.evaluate(id => {
      const j = Store.job(id);
      j.status = "complete"; Store.setPayment(j, { status:"invoiced", amountPaid: 0 });
      Store.save();
      App.scheduleMode = "day"; render();
      return { owed: Store.outstanding().some(x => x.id === id),
               onBoard: !!document.querySelector('.daygrid [data-job="'+id+'"]'),
               total: Store.jobTotal(j) };
    }, jid);
    if (!r.owed) throw new Error('money did not come back');
    if (!r.onBoard) throw new Error('it did not come back to the board');
    if (!(r.total > 0)) throw new Error('the job total was destroyed: ' + r.total);
  });

  await t('a live job is untouched by any of this', async () => {
    const ok = await pg.evaluate(() => {
      const live = Store.data.jobs.filter(j => j.status !== "cancelled" &&
        j.payment && j.payment.status === "invoiced");
      return live.every(j => Store.outstanding().some(x => x.id === j.id));
    });
    if (!ok) throw new Error('a live invoiced job fell out of outstanding');
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
