/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP = `file://${REPO_DIR}/index.html`;
const SHOTS = process.env.SP + '/shots';
const errs = [];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const page = await b.newPage({ viewport:{width:1500,height:1000} });
  page.on('console', m => { if (m.type()==='error') errs.push('CONSOLE: '+m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR: '+e.message));
  const t = async (n, fn) => { try { await fn(); console.log('  ok  '+n); }
    catch(e){ console.log('  FAIL '+n+' :: '+e.message); errs.push(n+': '+e.message); } };
  const sec = n => console.log('--- '+n+' ---');
  await page.goto(APP); await page.waitForTimeout(500);

  sec('rebrand');
  await t('company name throughout', async () => {
    const NAME = 'Poseidon Plumbing & Gasfitting Ltd.';
    if ((await page.textContent('#brand-name')).trim() !== NAME) throw new Error('sidebar');
    if (!(await page.title()).includes('Poseidon')) throw new Error('tab title');
    const docs = await page.evaluate(() => ({
      ticket: ticketHtml(Store.data.jobs[0]),
      est: estimateDocHtml(Store.data.estimates[0]),
      waiver: (() => { const tpl = Store.templateByKey('drain-condition');
        return tpl.body.map(p => Store.applyMerge(p, Store.waiverContext(Store.data.jobs[0]))).join(' '); })()
    }));
    const ESCAPED = NAME.replace(/&/g, '&amp;');
    for (const [k,v] of Object.entries(docs))
      if (!v.includes(NAME) && !v.includes(ESCAPED)) throw new Error(k+' missing name');
    const all = JSON.stringify(docs);
    for (const stale of ['Park City Plumbing', 'Plumbing and Heating'])
      if (all.includes(stale)) throw new Error('stale name in a document: '+stale);
  });
  await t('the real trident logo carries the app, not a placeholder letter', async () => {
    const m = await page.evaluate(() => {
      const el = document.querySelector('.brand .logo');
      const c = getComputedStyle(el);
      return { ch: el.textContent.trim(), bg: c.backgroundImage,
               round: c.borderRadius, label: el.getAttribute('aria-label') || '' };
    });
    if (m.ch) throw new Error('placeholder text still there: ' + JSON.stringify(m.ch));
    if (!m.bg.startsWith('url("data:image/png;base64,'))
      throw new Error('logo is not inlined: ' + m.bg.slice(0, 50));
    if (!/50%/.test(m.round)) throw new Error('badge is not round: ' + m.round);
    if (!/Poseidon/i.test(m.label)) throw new Error('no accessible name on the mark');
    console.log('       round, inlined, labelled "' + m.label + '"');
  });

  await t('the logo travels with the file and onto printed documents', async () => {
    const r = await page.evaluate(async () => {
      const root = getComputedStyle(document.documentElement).getPropertyValue('--logo').trim();
      // it must load, not just be declared
      const url = root.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
      const ok = await new Promise(res => {
        const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(0); i.src = url;
      });
      printJobs([Store.data.jobs[0]], 'x');
      return { px: ok, kb: Math.round(url.length / 1024),
               onDoc: !!document.querySelector('#print-area .doc-logo') };
    });
    if (!r.px) throw new Error('the inlined logo does not decode');
    if (!r.onDoc) throw new Error('no logo on the printed ticket');
    if (r.kb > 40) throw new Error('inlined logo is ' + r.kb + ' KB — too heavy to carry in the page');
    console.log('       ' + r.px + 'px, ' + r.kb + ' KB inlined, on the ticket');
  });

  await t('the home-screen icon and manifest are referenced', async () => {
    const h = await page.evaluate(() => ({
      touch: (document.querySelector('link[rel="apple-touch-icon"]')||{}).getAttribute
             ? document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href') : null,
      icon:  (document.querySelector('link[rel="icon"]')||{}).getAttribute
             ? document.querySelector('link[rel="icon"]').getAttribute('href') : null,
      man:   (document.querySelector('link[rel="manifest"]')||{}).getAttribute
             ? document.querySelector('link[rel="manifest"]').getAttribute('href') : null,
      title: (document.querySelector('meta[name="apple-mobile-web-app-title"]')||{}).content || null,
      theme: (document.querySelector('meta[name="theme-color"]')||{}).content || null
    }));
    for (const [k,v] of Object.entries(h)) if (!v) throw new Error('missing ' + k);
    if (h.title.length > 12) throw new Error('home-screen name will truncate: ' + h.title);
    console.log('       ' + h.touch + ' · ' + h.man + ' · "' + h.title + '" · ' + h.theme);
  });
  await t('brand tokens resolve', async () => {
    const v = await page.evaluate(() => {
      const c = getComputedStyle(document.documentElement);
      return ['--navy','--blue','--gold','--gold-soft','--amber','--green','--red']
        .map(k => k+'='+c.getPropertyValue(k).trim());
    });
    if (v.some(x => x.endsWith('='))) throw new Error('unset token: '+v.join(' '));
    console.log('       ' + v.join('  '));
  });
  await t('accent button is brass with navy text, not white', async () => {
    const st = await page.evaluate(() => {
      const el = document.querySelector('.btn.accent');
      const c = getComputedStyle(el);
      return { bg:c.backgroundColor, fg:c.color };
    });
    if (st.fg === 'rgb(255, 255, 255)') throw new Error('white text on gold is unreadable');
    console.log('       bg '+st.bg+' / text '+st.fg);
  });
  await t('red and green are still semantic only', async () => {
    const out = await page.evaluate(() => {
      const c = getComputedStyle(document.documentElement);
      const red = c.getPropertyValue('--red').trim(), green = c.getPropertyValue('--green').trim();
      const gold = c.getPropertyValue('--gold').trim(), navy = c.getPropertyValue('--navy').trim();
      // no brand surface should be painted red or green
      const brand = [document.querySelector('.brand .logo'), document.querySelector('.btn.accent'),
                     document.querySelector('#sidebar')].map(e => getComputedStyle(e).backgroundColor);
      return { red, green, gold, navy, brand };
    });
    const hex = s => { const m = s.match(/\d+/g); return m ? '#'+m.slice(0,3).map(n=>(+n).toString(16).padStart(2,'0')).join('') : s; };
    const brandHex = out.brand.map(hex);
    if (brandHex.includes(out.red) || brandHex.includes(out.green))
      throw new Error('a brand surface uses a semantic colour: '+brandHex.join(','));
    console.log('       brand surfaces: ' + brandHex.join(', '));
  });
  await t('old saved data is renamed on load', async () => {
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('pcp.dispatch.v1'));
      d.settings.company = 'Poseidon Plumbing and Heating Ltd.';
      localStorage.setItem('pcp.dispatch.v1', JSON.stringify(d));
    });
    await page.reload(); await page.waitForTimeout(500);
    const got = (await page.textContent('#brand-name')).trim();
    if (got !== 'Poseidon Plumbing & Gasfitting Ltd.') throw new Error('not migrated, got: '+got);
  });
  await t('a name the office typed is NOT overwritten', async () => {
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('pcp.dispatch.v1'));
      d.settings.company = 'Trident Mechanical';
      localStorage.setItem('pcp.dispatch.v1', JSON.stringify(d));
    });
    await page.reload(); await page.waitForTimeout(500);
    if ((await page.textContent('#brand-name')).trim() !== 'Trident Mechanical') throw new Error('clobbered');
    await page.evaluate(() => { Store.reset(); });
    await page.reload(); await page.waitForTimeout(500);
  });

  await t('service area is Edmonton, with Alberta specifics', async () => {
    const d = await page.evaluate(() => ({
      cities: [...new Set(Store.data.customers.map(c => c.city))],
      areaCodes: [...new Set(Store.data.customers.map(c => String(c.phone).slice(0,3)))],
      dig: Store.templateByKey('excavation').body.join(' '),
      note: document.querySelector('.legal-note') ? '' : ''
    }));
    if (d.cities.join() !== 'Edmonton') throw new Error('cities: '+d.cities.join());
    if (d.areaCodes.some(a => a === '435')) throw new Error('Utah area code left: '+d.areaCodes.join());
    if (!/Utility Safety Partners/.test(d.dig)) throw new Error('excavation waiver still cites the US one-call');
    console.log('       ' + d.cities.join() + ' · area codes ' + d.areaCodes.join('/'));
  });
  await t('legal language is Canadian', async () => {
    await page.click('[data-nav="waivers"]'); await page.waitForTimeout(300);
    const lg = (await page.textContent('.legal-note')).replace(/\s+/g,' ');
    if (/attorney/i.test(lg)) throw new Error('still says attorney');
    if (/by state/i.test(lg)) throw new Error('still says state');
    if (!/province/i.test(lg)) throw new Error('no province wording');
    await page.click('[data-nav="dashboard"]'); await page.waitForTimeout(250);
  });

  sec('dashboard + schedule');
  await t('dashboard renders with 6 stats and the money card', async () => {
    if (await page.$$eval('.stat .value', e=>e.length) !== 6) throw new Error('stats');
    if (!(await page.textContent('#view')).includes('Awaiting payment')) throw new Error('money card');
  });
  await page.screenshot({ path: SHOTS+'/r1-dash.png' });
  await page.click('[data-nav="schedule"]'); await page.waitForTimeout(300);
  await t('day board: hours down, technicians across, drag assigns', async () => {
    // the day is a timetable now: a column head per technician plus Unassigned
    if (await page.$$eval('.dg-head', e=>e.length) !== 5) throw new Error('cols');
    const times = await page.$$eval('.dg-time', e => e.map(x => x.textContent.trim()));
    if (times.join('|') !== 'ASAP|8–10|10–12|12–2|2–4|4–6|Any time') throw new Error('rows: '+times.join('/'));
    const before = await page.locator('.dg-cell.unassigned .minicard').count();
    if (!before) throw new Error('nothing unassigned to drag');
    const card = page.locator('.dg-cell.unassigned .minicard').first();
    const jid = await card.getAttribute('data-job');
    await card.dragTo(page.locator('.dg-cell:not(.unassigned)').first());
    await page.waitForTimeout(400);
    const j = await page.evaluate(id => { const x = Store.job(id);
      return { tech: x.techId, win: x.window }; }, jid);
    if (!j.tech) throw new Error('the drag did not assign a technician');
    if (await page.locator('.dg-cell.unassigned .minicard').count() !== before-1) throw new Error('drag');
  });
  await page.screenshot({ path: SHOTS+'/r2-day.png' });
  await t('week grid: 7 days x the hours, cross-drag moves day, tech and slot', async () => {
    await page.click('[data-smode="week"]'); await page.waitForTimeout(400);
    // seven days x technicians is wider than any screen; widen the window so the
    // drag is testing the drop handler and not playwright's sideways scrolling
    const vp = page.viewportSize();
    const wide = await page.evaluate(() => {
      const w = document.querySelector('.daygrid-wrap');
      return w ? w.scrollWidth + 80 : 1400; });
    await page.setViewportSize({ width: Math.min(wide, 6000), height: vp.height });
    await page.waitForTimeout(350);
    const shape = await page.evaluate(() => ({
      days:  document.querySelectorAll('.weekhours .wt-day').length,
      rows:  document.querySelectorAll('.weekhours .dg-time').length,
      cells: document.querySelectorAll('.weekhours .dg-cell').length,
      subs:  Store.activeTechs().length + 1 }));
    if (shape.days !== 7) throw new Error('days=' + shape.days);
    if (shape.rows !== 7) throw new Error('hour rows=' + shape.rows);
    if (shape.cells !== 7 * 7 * shape.subs) throw new Error('cells=' + shape.cells);

    const before = await page.evaluate(() => {
      const j = Store.job(document.querySelector('.weekhours .dg-cell .minicard').dataset.job);
      return { id:j.id, date:j.scheduledDate, tech:j.techId||'', win:j.window };
    });
    // a square that differs in all three: another day, another tech, another hour
    const tgt = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.weekhours .dg-cell')];
      const src = document.querySelector('.weekhours .dg-cell .minicard').closest('.dg-cell');
      const h = cells.find(c => c.dataset.dropDate   !== src.dataset.dropDate
                             && c.dataset.dropTech   !== src.dataset.dropTech
                             && c.dataset.dropWindow !== src.dataset.dropWindow);
      return { i: cells.indexOf(h), date: h.dataset.dropDate,
               tech: h.dataset.dropTech, win: h.dataset.dropWindow };
    });
    if (tgt.i < 0) throw new Error('no square differing in all three');
    await page.locator('.weekhours .dg-cell .minicard').first()
      .dragTo(page.locator('.weekhours .dg-cell').nth(tgt.i));
    await page.waitForTimeout(450);
    const after = await page.evaluate(id => { const j = Store.job(id);
      return { date:j.scheduledDate, tech:j.techId||'', win:j.window }; }, before.id);
    if (after.date !== tgt.date) throw new Error('date ' + after.date + ' != ' + tgt.date);
    if (after.tech !== tgt.tech) throw new Error('tech ' + after.tech + ' != ' + tgt.tech);
    if (after.win  !== tgt.win)  throw new Error('slot ' + after.win  + ' != ' + tgt.win);
    await page.setViewportSize(vp); await page.waitForTimeout(250);
  });
  await page.screenshot({ path: SHOTS+'/r3-week.png' });
  await t('month grid: whole weeks, all jobs accounted for, day drill-in', async () => {
    await page.click('[data-smode="month"]'); await page.waitForTimeout(350);
    const cells = await page.$$eval('.mo-cell', e=>e.length);
    if (cells % 7) throw new Error('cells='+cells);
    const c = await page.evaluate(() => {
      const shown = document.querySelectorAll('.mo-cell .minicard').length;
      const more = [...document.querySelectorAll('.mo-more')].reduce((s,e)=>s+Number(e.textContent.replace(/\D/g,'')),0);
      const days = [...document.querySelectorAll('.mo-cell')].map(x=>x.dataset.dropDate);
      return { shown, more, real: Store.data.jobs.filter(j=>days.includes(j.scheduledDate)).length };
    });
    if (c.shown + c.more !== c.real) throw new Error(JSON.stringify(c));
    await page.click('.mo-cell .minicard'); await page.waitForTimeout(350);
    if (!(await page.textContent('.modal-head')).includes('Job #')) throw new Error('card should open the job');
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  });
  await page.screenshot({ path: SHOTS+'/r4-month.png' });
  await t('arrows step by the active view', async () => {
    const step = async m => { await page.click(`[data-smode="${m}"]`); await page.waitForTimeout(250);
      const a = await page.evaluate(()=>App.date); await page.click('[data-date="next"]'); await page.waitForTimeout(250);
      return Math.round((new Date(await page.evaluate(()=>App.date)) - new Date(a))/86400000); };
    const d=await step('day'), w=await step('week'), m=await step('month');
    if (d!==1 || w!==7 || m<28 || m>31) throw new Error(`${d}/${w}/${m}`);
    await page.click('[data-date="today"]'); await page.waitForTimeout(250);
  });

  sec('jobs, estimates, waivers, payment');
  await t('job detail: status, part, labor, note', async () => {
    await page.click('[data-nav="jobs"]'); await page.waitForTimeout(300);
    await page.click('tbody tr[data-job]'); await page.waitForTimeout(350);
    const SEL = '.modal-head .badge[class*="s-"]';
    const b4 = await page.textContent(SEL);
    await page.click('[data-advance]'); await page.waitForTimeout(300);
    if (await page.textContent(SEL) === b4) throw new Error('status did not advance');
    await page.fill('#part-desc','Test coupling'); await page.fill('#part-price','12.50');
    await page.click('[data-add-part]'); await page.waitForTimeout(300);
    if (!(await page.textContent('.modal')).includes('Test coupling')) throw new Error('part');
    await page.fill('#note-text','Regression note'); await page.click('[data-add-note]'); await page.waitForTimeout(300);
    if (!(await page.textContent('.timeline')).includes('Regression note')) throw new Error('note');
  });
  await t('payment: mark paid fills the total, balance clears', async () => {
    const total = await page.evaluate(() => Store.jobTotal(Store.job(document.querySelector('[data-save-pay]').dataset.savePay)));
    await page.selectOption('#pay-status','paid'); await page.fill('#pay-ref','REG-1');
    await page.click('[data-save-pay]'); await page.waitForTimeout(400);
    const g = await page.evaluate(() => { const j = Store.data.jobs.find(x=>x.payment.ref==='REG-1');
      return { a:j.payment.amountPaid, b:Store.balance(j) }; });
    if (Math.abs(g.a-total) > 0.01 || g.b !== 0) throw new Error(JSON.stringify(g)+' total '+total);
    await page.click('.modal-foot [data-close]'); await page.waitForTimeout(250);
  });
  await t('estimate: price-book line, then approve & convert', async () => {
    await page.click('[data-nav="estimates"]'); await page.waitForTimeout(300);
    await page.click('[data-action="new-estimate"]'); await page.waitForTimeout(300);
    await page.fill('#l-name','Regression Lead'); await page.fill('#l-address','1 Test Way');
    await page.fill('#e-desc','Automated regression estimate.');
    await page.click('[data-save-estimate]'); await page.waitForTimeout(400);
    const pb = await page.$$eval('#pb-pick option', o => { const m = o.find(x=>x.textContent.includes('Standard labor')); return m?m.value:''; });
    await page.selectOption('#pb-pick', pb); await page.waitForTimeout(250);
    await page.fill('#line-qty','4'); await page.click('[data-add-line]'); await page.waitForTimeout(350);
    if (!(await page.textContent('.modal')).includes('$580.00')) throw new Error('4 x 145 not totalled');
    // Approving is the whole step now — the job gets made, with no date on it
    await page.click('.modal [data-est-status$=":approved"]'); await page.waitForTimeout(500);
    const txt = await page.textContent('.modal');
    if (!txt.includes('Regression Lead')) throw new Error('customer not created');
    if (!txt.includes('$580.00')) throw new Error('quoted total did not carry');
    const made = await page.evaluate(() => {
      const e = Store.data.estimates.find(x => x.description === 'Automated regression estimate.');
      const j = e && e.jobId ? Store.job(e.jobId) : null;
      return j ? { no: j.no, date: j.scheduledDate, cust: Store.customer(j.customerId).name } : null;
    });
    if (!made) throw new Error('approving did not make the job');
    if (made.date) throw new Error('it scheduled itself for ' + made.date);
    if (made.cust !== 'Regression Lead') throw new Error('job is on ' + made.cust);
    await page.click('.modal-foot [data-close]'); await page.waitForTimeout(250);
  });
  await t('waiver: 14 templates, sign one, frozen text', async () => {
    await page.click('[data-nav="waivers"]'); await page.waitForTimeout(300);
    if (await page.$$eval('.tpl-card', e=>e.length) !== 14) throw new Error('templates');
    const lg = (await page.textContent('.legal-note')).replace(/\s+/g,' ');
    if (!/lawyer/i.test(lg) || !/gross negligence/i.test(lg) || !/province/i.test(lg))
      throw new Error('legal caveat wording: '+lg.slice(0,120));
    await page.click('[data-nav="jobs"]'); await page.waitForTimeout(300);
    await page.click('tr:has-text("Ironwood Brewing")'); await page.waitForTimeout(400);
    await page.click('.modal [data-add-waiver]'); await page.waitForTimeout(350);
    await page.click('[data-pick-template]'); await page.waitForTimeout(400);
    const n = await page.$$eval('.wv-ack', e=>e.length);
    for (let i=0;i<n;i++) await page.check('#ack-'+i);
    await page.locator('#sigpad').scrollIntoViewIfNeeded(); await page.waitForTimeout(250);
    const bx = await page.locator('#sigpad').boundingBox(), y0 = bx.y+bx.height/2;
    await page.mouse.move(bx.x+30,y0); await page.mouse.down();
    for (const d of [[50,-25],[110,20],[170,-20],[220,10]]) await page.mouse.move(bx.x+30+d[0], y0+d[1]);
    await page.mouse.up(); await page.waitForTimeout(200);
    await page.fill('#wv-name','Reg Signer');
    await page.click('[data-sign-waiver]'); await page.waitForTimeout(500);
    if (!(await page.textContent('.modal')).includes('Reg Signer')) throw new Error('not recorded');
    const sig = await page.evaluate(() => Store.data.signedWaivers.slice(-1)[0].signature.length);
    if (sig < 500 || sig > 40000) throw new Error('signature size '+sig+' bytes');
    console.log('       signature '+(sig/1024).toFixed(1)+' KB');
  });
  await t('search finds across jobs, estimates, customers', async () => {
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await page.fill('#global-search','5550231'); await page.waitForTimeout(450);
    if (!(await page.textContent('#view')).includes('Holly Bennett')) throw new Error('phone search');
    await page.fill('#global-search',''); await page.waitForTimeout(350);
  });
  await t('everything survives a reload', async () => {
    await page.reload(); await page.waitForTimeout(500);
    const n = await page.evaluate(() => ({ w: Store.data.signedWaivers.length, e: Store.data.estimates.length }));
    if (n.w < 1 || n.e < 5) throw new Error(JSON.stringify(n));
  });

  console.log('--- page geometry ---');
  await t('a long page is as tall as its content, not one viewport', async () => {
    await page.evaluate(() => go('pricebook')); await page.waitForTimeout(350);
    const m = await page.evaluate(() => ({
      body: Math.round(document.body.getBoundingClientRect().height),
      doc: document.scrollingElement.scrollHeight,
      rows: document.querySelectorAll('tbody tr').length
    }));
    if (m.doc <= m.body + 2 === false && Math.abs(m.doc - m.body) > 4)
      throw new Error('body '+m.body+' vs content '+m.doc+' — an embedding frame would clip it');
    if (m.rows !== 19) throw new Error('price book rows='+m.rows);
    console.log('       body ' + m.body + 'px = content ' + m.doc + 'px, all 19 items');
  });
  await t('every item in the price book is reachable by scrolling', async () => {
    await page.evaluate(() => document.scrollingElement.scrollTo(0, 99999));
    await page.waitForTimeout(250);
    const ok = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('tbody tr')];
      const last = rows[rows.length-1];
      return { text: last.textContent.trim().slice(0,30),
               fully: Math.round(last.getBoundingClientRect().bottom) <= window.innerHeight + 2 };
    });
    if (!ok.fully) throw new Error('last row still cut off: '+ok.text);
    console.log('       bottom row "' + ok.text.replace(/\s+/g,' ') + '" fully visible');
  });

  await b.close();
  const hard = errs.filter(e => e.startsWith('CONSOLE') || e.startsWith('PAGEERROR'));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e => console.log('  '+e));
  process.exit(errs.length ? 1 : 0);
})();
