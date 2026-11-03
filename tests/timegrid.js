/* The day should read as a timetable: hours down the side, who's working
   across the top, and an empty square is an hour he can still sell. */
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

  const today = await pg.evaluate(() => { App.view="schedule"; App.scheduleMode="day"; App.date=todayStr(); render(); return todayStr(); });
  await pg.waitForTimeout(400);

  await t('the hours he works run down the left', async () => {
    const times = await pg.evaluate(() =>
      [...document.querySelectorAll('.dg-time')].map(e => e.textContent.trim()));
    const want = ["ASAP","8–10","10–12","12–2","2–4","4–6","Any time"];
    if (times.join("|") !== want.join("|")) throw new Error('rows read: ' + times.join(" / "));
  });

  await t('every technician gets a column, with Unassigned first', async () => {
    const heads = await pg.evaluate(() =>
      [...document.querySelectorAll('.dg-head .nm')].map(e => e.textContent.trim()));
    if (heads[0] !== "Unassigned") throw new Error('first column is ' + heads[0]);
    const techs = await pg.evaluate(() => Store.activeTechs().length);
    if (heads.length !== techs + 1) throw new Error(heads.length + ' columns for ' + techs + ' techs');
  });

  await t('each square is its own drop target, naming slot and technician', async () => {
    const cells = await pg.evaluate(() => [...document.querySelectorAll('.dg-cell')].map(c => ({
      w: c.dataset.dropWindow, t: c.dataset.dropTech, d: c.dataset.dropDate })));
    const rows = 7, cols = await pg.evaluate(() => Store.activeTechs().length + 1);
    if (cells.length !== rows * cols) throw new Error(cells.length + ' squares, expected ' + rows*cols);
    if (cells.some(c => !c.w || c.d == null)) throw new Error('a square names no slot or no date');
  });

  await t('a job sits in the square where its slot meets its technician', async () => {
    const r = await pg.evaluate(d => {
      const tech = Store.activeTechs()[0];
      const j = Store.data.jobs[0];
      j.scheduledDate = d; j.window = "12:00–2:00"; Store.assign(j, tech.id); Store.save(); render();
      const cell = document.querySelector('.dg-cell[data-drop-window="12:00–2:00"][data-drop-tech="'+tech.id+'"]');
      return { found: !!(cell && cell.querySelector('[data-job="'+j.id+'"]')), no: j.no };
    }, today);
    await pg.waitForTimeout(300);
    if (!r.found) throw new Error('job #' + r.no + ' is not in the 12–2 square');
  });

  await t('dropping into a square sets the slot and the technician together', async () => {
    const r = await pg.evaluate(d => {
      const tech = Store.activeTechs()[0];
      const j = Store.data.jobs[0];
      j.window = "Anytime"; Store.assign(j, null); Store.save(); render();
      // what the drop handler does, with the cell's own dataset
      const cell = document.querySelector('.dg-cell[data-drop-window="4:00–6:00"][data-drop-tech="'+tech.id+'"]');
      const ds = cell.dataset;
      Store.setDate(j, ds.dropDate);
      Store.assign(j, ds.dropTech || null);
      Store.setWindow(j, ds.dropWindow);
      return { win: j.window, tech: j.techId === tech.id, date: j.scheduledDate === d,
               logged: (j.log||[]).some(l => /Arrival window set to 4:00/.test(l.text)) };
    }, today);
    if (r.win !== "4:00–6:00") throw new Error('window is ' + r.win);
    if (!r.tech) throw new Error('technician did not change');
    if (!r.date) throw new Error('date did not change');
    if (!r.logged) throw new Error('the move was never written to the job log');
  });

  await t('a job with an odd window still lands somewhere, not nowhere', async () => {
    const seen = await pg.evaluate(d => {
      const j = Store.data.jobs[1];
      j.scheduledDate = d; j.window = "whenever mate"; Store.save(); render();
      return !!document.querySelector('[data-job="'+j.id+'"]');
    }, today);
    await pg.waitForTimeout(250);
    if (!seen) throw new Error('it vanished off the board entirely');
  });

  await t('the card drops the window, which the row already says', async () => {
    const txt = await pg.evaluate(() => {
      const c = document.querySelector('.dg-cell .minicard');
      return c ? c.textContent.replace(/\s+/g,' ') : null;
    });
    if (txt === null) throw new Error('no card on the board');
    if (/\d+:\d+/.test(txt)) throw new Error('card still repeats the time :: ' + txt);
  });

  await t('the unscheduled strip above the board is untouched', async () => {
    const ok = await pg.evaluate(() => {
      const j = Store.data.jobs.find(x => x.status !== "complete");
      j.scheduledDate = null; Store.save(); render();
      return !!document.querySelector('.tray-strip [data-job="'+j.id+'"]');
    });
    await pg.waitForTimeout(250);
    if (!ok) throw new Error('the no-date tray stopped working');
  });

  console.log('--- the week, with hours ---');
  await t('the week runs the same hours down the side', async () => {
    await pg.setViewportSize({ width:1400, height:1000 });
    await pg.evaluate(() => { App.scheduleMode = "week"; render(); }); await pg.waitForTimeout(450);
    const times = await pg.evaluate(() =>
      [...document.querySelectorAll('.weekhours .dg-time')].map(e => e.textContent.trim()));
    const want = ["ASAP","8–10","10–12","12–2","2–4","4–6","Any time"];
    if (times.join("|") !== want.join("|")) throw new Error('week rows read: ' + times.join(" / "));
  });

  await t('seven days across, each spanning its own technician columns', async () => {
    const r = await pg.evaluate(() => {
      const days = [...document.querySelectorAll('.weekhours .wt-day')];
      const span = days[0] ? days[0].style.gridColumn : '';
      return { days: days.length, span, techs: Store.activeTechs().length,
               heads: document.querySelectorAll('.weekhours .wt-tech').length };
    });
    if (r.days !== 7) throw new Error(r.days + ' day headers');
    if (!r.span.includes('span ' + (r.techs + 1))) throw new Error('date spans "' + r.span + '"');
    if (r.heads !== 7 * (r.techs + 1)) throw new Error(r.heads + ' technician headers');
  });

  await t('every square in the week names a day, a technician and an hour', async () => {
    const cells = await pg.evaluate(() => [...document.querySelectorAll('.weekhours .dg-cell')]
      .map(c => ({ d:c.dataset.dropDate, t:c.dataset.dropTech, w:c.dataset.dropWindow })));
    const techs = await pg.evaluate(() => Store.activeTechs().length + 1);
    if (cells.length !== 7 * techs * 7) throw new Error(cells.length + ' squares');
    if (cells.some(c => !c.d || !c.w || c.t == null)) throw new Error('a square is missing a field');
    if (new Set(cells.map(c => c.d)).size !== 7) throw new Error('the squares do not cover 7 days');
  });

  await t('a booked job shows in the right square of the week', async () => {
    const r = await pg.evaluate(d => {
      const tech = Store.activeTechs()[0], j = Store.data.jobs[0];
      j.scheduledDate = d; j.window = "10:00–12:00"; Store.assign(j, tech.id); Store.save(); render();
      const cell = document.querySelector('.weekhours .dg-cell[data-drop-date="'+d+'"]'
        + '[data-drop-window="10:00–12:00"][data-drop-tech="'+tech.id+'"]');
      return !!(cell && cell.querySelector('[data-job="'+j.id+'"]'));
    }, today);
    await pg.waitForTimeout(300);
    if (!r) throw new Error('not in its square on the week');
  });

  await t('Any time has room to pile work up, not a thin strip', async () => {
    const h = await pg.evaluate(() => {
      const c = document.querySelector('.daygrid .dg-cell.loose');
      return c ? c.getBoundingClientRect().height : 0;
    });
    if (h < 90) throw new Error('the Any time bay is only ' + Math.round(h) + 'px tall');
  });

  await t('week and month views still render', async () => {
    for (const m of ["week","month"]){
      await pg.evaluate(x => { App.scheduleMode = x; render(); }, m); await pg.waitForTimeout(350);
      const n = await pg.evaluate(() => document.querySelectorAll('[data-drop]').length);
      if (!n) throw new Error(m + ' view has no drop targets');
    }
  });

  console.log('--- on a machine set to dark ---');
  await t('the app has no half-finished dark theme in it', async () => {
    const n = await pg.evaluate(() => {
      let hits = 0;
      for (const sheet of document.styleSheets){
        let rules; try { rules = sheet.cssRules; } catch(e){ continue; }
        for (const r of rules) if (r.conditionText && /prefers-color-scheme/.test(r.conditionText)) hits++;
      }
      return hits;
    });
    if (n) throw new Error(n + ' dark-mode block(s) in an app with no dark theme');
  });

  await t('nothing in the board renders dark text on a dark panel', async () => {
    const dark = await b.newPage({ viewport:{width:1500,height:1000}, colorScheme:'dark' });
    dark.on('pageerror',e=>errs.push('DARK PAGEERROR: '+e.message));
    await dark.goto(`file://${APP}/index.html`); await dark.waitForTimeout(500);
    const bad = await dark.evaluate(() => {
      const lum = c => { const m = c.match(/\d+/g); if (!m) return 1;
        return (0.2126*m[0] + 0.7152*m[1] + 0.0722*m[2]) / 255; };
      const out = [];
      const check = () => {
        for (const el of document.querySelectorAll(
          '.dg-time,.dg-head,.dg-cell,.wt-day,.wt-tech,.dg-corner,.wt-corner')){
          const st = getComputedStyle(el);
          const bg = lum(st.backgroundColor), fg = lum(st.color);
          // both ends dark, with text actually in it, means unreadable
          if (bg < 0.35 && fg < 0.45 && el.textContent.trim())
            out.push(el.className + ' bg=' + st.backgroundColor + ' fg=' + st.color);
        }
      };
      App.view="schedule"; App.scheduleMode="day"; App.date=todayStr(); render(); check();
      App.scheduleMode="week"; render(); check();
      return out.slice(0,4);
    });
    await dark.close();
    if (bad.length) throw new Error(bad.join(' | '));
  });

  await t('it fits a phone without breaking the page', async () => {
    await pg.setViewportSize({ width:390, height:844 });
    await pg.evaluate(() => { App.scheduleMode = "day"; render(); }); await pg.waitForTimeout(400);
    const r = await pg.evaluate(() => ({
      pageScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      grid: !!document.querySelector('.daygrid') }));
    if (!r.grid) throw new Error('no grid on a phone');
    if (r.pageScroll) throw new Error('the whole page scrolls sideways');
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
