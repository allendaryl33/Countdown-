/* Going to look at it.

   Between "she sent photos" and "here is the price" there is a trip, and it
   takes a real hour out of a real day. Before this, a lead could become a job
   he could drag onto the board, or an estimate that appeared nowhere — so the
   one thing he actually needed to book, the visit, had no home.

   It hangs off the estimate rather than being a job, because nothing is owed
   for a trip: it must never raise an invoice, never count as work in Time &
   Money, and never be mistaken on the board for work he has sold. */
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

  const today = await pg.evaluate(() => todayStr());

  /* A lead exactly like Chelsea's: photos, a write-up, enough to go and look. */
  const eid = await pg.evaluate(() => {
    const lead = {
      id: uid("lead"), at: Date.now(), source: "website", status: "open",
      name: "Chelsea Mowat", phone: "7805550177", email: "chelsea@example.com",
      address: "9915 Saskatchewan Dr", service: "shower is leaking downstairs",
      what: "water showing on the ceiling below the ensuite", photos: []
    };
    Store.data.leads = Store.data.leads || [];
    Store.data.leads.push(lead);
    const e = Store.estimateFromLead(lead);
    Store.save();
    return e.id;
  });
  const est = () => pg.evaluate(i => Store.estimate(i), eid);
  const board = async (mode) => {
    await pg.evaluate(m => { App.search=''; go('schedule'); App.scheduleMode=m; render(); }, mode||'week');
    await pg.waitForTimeout(400);
  };

  await t('an estimate nobody has been out to see yet waits in the tray', async () => {
    await board('week');
    const r = await pg.evaluate(i => {
      const card = document.querySelector(`.tray-strip [data-estvisit="${i}"]`);
      const head = (document.querySelector('.tray-head') || {}).innerText || '';
      return { there: !!card, head };
    }, eid);
    if (!r.there) throw new Error('not in the tray: ' + r.head);
    if (!/look at/i.test(r.head)) throw new Error('the tray does not say what it is: ' + r.head);
  });

  await t('it does not look like a job', async () => {
    // the tray needs a job in it too, or there is nothing to tell apart
    await pg.evaluate(() => {
      const j = Store.data.jobs.find(x => isOpen(x));
      if (j){ j.scheduledDate = null; Store.save(); }
    });
    await board('week');
    const r = await pg.evaluate(() => {
      const v = document.querySelector('.tray-strip .estcard');
      const j = document.querySelector('.tray-strip .minicard:not(.estcard)');
      if (!v) return { err:'no visit card' };
      if (!j) return { err:'no job card to compare against' };
      const st = el => { const c = getComputedStyle(el);
        return { border: c.borderTopStyle, bg: c.backgroundColor }; };
      return { visit: st(v), job: st(j), text: v.innerText };
    });
    if (r.err) throw new Error(r.err);
    if (r.visit.border !== 'dashed') throw new Error('visit border is ' + r.visit.border);
    if (r.job.border === 'dashed') throw new Error('job cards are dashed too, so it tells him nothing');
    if (r.visit.bg === r.job.bg) throw new Error('same background as a job card');
    if (!/look at it/i.test(r.text)) throw new Error('it does not say what it is: ' + r.text);
  });

  await t('it is nowhere near the money — no invoice, no earnings', async () => {
    const r = await pg.evaluate(() => ({
      toSend: Store.invToSend().length,
      toBill: Store.toInvoice().length,
      jobs:   Store.data.jobs.length
    }));
    const after = await pg.evaluate(i => {
      Store.setVisit(Store.estimate(i), todayStr(), "8:00–10:00", null);
      return { toSend: Store.invToSend().length, toBill: Store.toInvoice().length,
               jobs: Store.data.jobs.length };
    }, eid);
    if (after.jobs !== r.jobs) throw new Error('booking a visit created a job');
    if (after.toSend !== r.toSend || after.toBill !== r.toBill)
      throw new Error('a visit reached the invoice lists');
  });

  await t('once booked it sits on the day board, in its slot', async () => {
    await board('day');
    const r = await pg.evaluate(([i,d]) => {
      App.date = d; render();
      return null;
    }, [eid, today]);
    await pg.waitForTimeout(350);
    const cell = await pg.evaluate(i => {
      const card = document.querySelector(`[data-estvisit="${i}"]`);
      if (!card) return { err:'not on the day board' };
      const c = card.closest('[data-drop]');
      return { win: c && c.dataset.dropWindow, tech: c && c.dataset.dropTech };
    }, eid);
    if (cell.err) throw new Error(cell.err);
    if (cell.win !== '8:00–10:00') throw new Error('it landed in the ' + cell.win + ' row');
  });

  await t('and it has left the tray, because it is booked now', async () => {
    await board('week');
    const still = await pg.evaluate(i => !!document.querySelector(`.tray-strip [data-estvisit="${i}"]`), eid);
    if (still) throw new Error('still sitting in the tray after being booked');
  });

  await t('clicking it opens the estimate, not a job', async () => {
    await board('day');
    await pg.evaluate(i => document.querySelector(`[data-estvisit="${i}"]`).click(), eid);
    await pg.waitForTimeout(400);
    const head = await pg.evaluate(() => (document.querySelector('#modal-root') || {}).innerText || '');
    if (!/EST-/.test(head)) throw new Error('did not open the estimate: ' + head.slice(0,120));
    if (!/Chelsea/.test(head)) throw new Error('wrong record: ' + head.slice(0,120));
  });

  await t('the estimate itself can book, move and clear the visit', async () => {
    const other = await pg.evaluate(() => addDays(todayStr(), 3));
    await pg.evaluate(o => {
      document.querySelector('#est-visit').value = o;
      document.querySelector('#est-visit-win').value = "2:00–4:00";
    }, other);
    await pg.click('[data-save-visit]'); await pg.waitForTimeout(450);
    let e = await est();
    if (e.visitDate !== other) throw new Error('date is ' + e.visitDate);
    if (e.window !== "2:00–4:00") throw new Error('window is ' + e.window);
    await pg.click('[data-clear-visit]'); await pg.waitForTimeout(450);
    e = await est();
    if (e.visitDate) throw new Error('clearing left ' + e.visitDate);
  });

  await t('clearing it puts it back in the tray', async () => {
    await board('week');
    const there = await pg.evaluate(i => !!document.querySelector(`.tray-strip [data-estvisit="${i}"]`), eid);
    if (!there) throw new Error('it did not come back');
  });

  await t('the estimate log records each of those, in his words', async () => {
    const log = await pg.evaluate(i => (Store.estimate(i).log||[]).map(l => l.text||l).join(' | '), eid);
    if (!/Visit booked for/i.test(log)) throw new Error('no booking recorded: ' + log);
    if (!/Visit moved to/i.test(log))   throw new Error('no move recorded: ' + log);
    if (!/Visit unbooked/i.test(log))   throw new Error('no clearing recorded: ' + log);
  });

  await t('a decided estimate stops asking to be visited', async () => {
    const r = await pg.evaluate(i => {
      const e = Store.estimate(i);
      e.status = "declined"; Store.save();
      const inTray = Store.estNeedsVisit().some(x => x.id === i);
      e.status = "approved"; Store.save();
      const inTray2 = Store.estNeedsVisit().some(x => x.id === i);
      e.status = "draft"; Store.save();
      return { declined: inTray, approved: inTray2 };
    }, eid);
    if (r.declined) throw new Error('a declined quote still nags him to go and look');
    if (r.approved) throw new Error('an approved quote still nags him to go and look');
  });

  await t('a booked visit drops off the board once the quote is decided', async () => {
    const r = await pg.evaluate(([i,d]) => {
      const e = Store.estimate(i);
      Store.setVisit(e, d, "Anytime", null);
      const on = Store.estVisitsOn(d).length;
      e.status = "approved"; Store.save();
      const after = Store.estVisitsOn(d).length;
      e.status = "draft"; Store.save();
      return { on, after };
    }, [eid, today]);
    if (!r.on) throw new Error('it was never on the board');
    if (r.after !== r.on - 1) throw new Error('an approved quote still shows its old visit');
  });

  await t('the month counts a visit as something on that day', async () => {
    await pg.evaluate(([i,d]) => { Store.setVisit(Store.estimate(i), d, "Anytime", null);
      App.date = d; }, [eid, today]);
    await board('month');
    const r = await pg.evaluate(d => {
      const cell = document.querySelector(`.mo-cell[data-goday="${d}"]`);
      if (!cell) return { err:'no cell for today' };
      return { count: (cell.querySelector('.dcount')||{}).textContent,
               card: !!cell.querySelector('.estcard') };
    }, today);
    if (r.err) throw new Error(r.err);
    if (!r.card) throw new Error('the visit is not shown on the month');
    if (!r.count) throw new Error('the day count does not include it');
  });

  await b.close();
  if (errs.length){
    console.log('\n' + errs.length + ' problem(s)');
    errs.forEach(e => console.log('  - ' + e));
    process.exit(1);
  }
  console.log('\nall good');
})();
