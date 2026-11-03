/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP=`file://${REPO_DIR}/index.html`, errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1500,height:1100} });
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await pg.goto(APP); await pg.waitForTimeout(500);

  const reset = async () => { await pg.evaluate(()=>localStorage.clear()); await pg.reload(); await pg.waitForTimeout(400); };

  console.log('--- formatting ---');
  await t('durations read the way a plumber writes them', async () => {
    const got = await pg.evaluate(() => [
      fmtDur(0), fmtDur(45*1000), fmtDur(9*60000), fmtDur(60*60000),
      fmtDur(84*60000), fmtDur(3*3600000 + 7*60000), fmtClock(5025000)
    ]);
    const want = ['0m','1m','9m','1h','1h 24m','3h 7m','1:23:45'];
    if (JSON.stringify(got) !== JSON.stringify(want))
      throw new Error(JSON.stringify(got)+' != '+JSON.stringify(want));
    console.log('       ' + got.join(' | '));
  });

  console.log('--- the basic trip ---');
  await t('clock in from the Today card starts a run', async () => {
    await reset();
    await pg.click('[data-clock^="in:job:"]');
    await pg.waitForTimeout(150);
    const r = await pg.evaluate(() => { const x = Store.running(); return x && {kind:x.kind, id:x.rec.id, open:!x.entry.endedAt}; });
    if (!r || !r.open) throw new Error('nothing running: '+JSON.stringify(r));
    if (!await pg.$('#clockbar.on')) throw new Error('no running bar');
  });
  await t('the bar names the job and counts up', async () => {
    const a = await pg.$eval('#clock-elapsed', e=>e.textContent);
    await pg.waitForTimeout(1400);
    const c = await pg.$eval('#clock-elapsed', e=>e.textContent);
    if (a === c) throw new Error('clock frozen at '+a);
    console.log('       ' + a + ' -> ' + c);
  });
  await t('the ticking clock does not steal what you are typing', async () => {
    await pg.click('[data-nav="customers"]'); await pg.waitForTimeout(250);
    const box = await pg.$('input[type="search"], .toolbar input');
    if (!box) throw new Error('no input to type in');
    await box.click(); await box.type('Kow');
    await pg.waitForTimeout(1600);
    const st = await pg.evaluate(() => ({ v: document.activeElement.value, tag: document.activeElement.tagName }));
    if (st.tag !== 'INPUT' || st.v !== 'Kow') throw new Error('focus/text lost: '+JSON.stringify(st));
    console.log('       still in the box with "Kow"');
  });
  await t('clock out closes it and writes the time to the record', async () => {
    const id = await pg.evaluate(() => Store.running().rec.id);
    await pg.evaluate(id => { const j = Store.job(id); j.timeEntries[0].startedAt = Date.now() - 82*60000; Store.save(); }, id);
    await pg.click('#clockbar [data-clock^="out:"]'); await pg.waitForTimeout(250);
    const r = await pg.evaluate(id => {
      const j = Store.job(id);
      return { running: !!Store.running(), mins: Math.round(Store.totalMs(j)/60000),
               closed: !!j.timeEntries[0].endedAt, log: (j.log||[]).map(l=>l.text).join(' ~ ') };
    }, id);
    if (r.running) throw new Error('still running');
    if (!r.closed) throw new Error('entry left open');
    if (r.mins < 81 || r.mins > 83) throw new Error('mins='+r.mins);
    if (!/1h 2[0-9]m/.test(r.log)) throw new Error('log says: '+r.log);
    if (await pg.$('#clockbar.on')) throw new Error('bar still up');
    console.log('       ' + r.mins + ' min on the record, logged');
  });

  console.log('--- more than one trip ---');
  await t('a second trip adds to the job total, it does not replace it', async () => {
    const id = await pg.evaluate(() => Store.running() ? null : Store.data.jobs.find(j=>Store.totalMs(j)>0).id);
    const tot = await pg.evaluate(id => {
      Store.addEntry('job', id, Date.now()-3*3600000, Date.now()-3600000, 'second trip');
      return { n: Store.entriesOf(Store.job(id)).length, mins: Math.round(Store.totalMs(Store.job(id))/60000) };
    }, id);
    if (tot.n !== 2) throw new Error('entries='+tot.n);
    if (tot.mins < 200 || tot.mins > 204) throw new Error('mins='+tot.mins);
    console.log('       2 trips, ' + tot.mins + ' min all in');
  });
  await t('only one clock runs at a time — the other stops itself and says so', async () => {
    const r = await pg.evaluate(() => {
      const [a,b] = Store.data.jobs.slice(0,2).map(j=>j.id);
      Store.clockIn('job', a);
      Store.clockIn('job', b);
      const ea = Store.entriesOf(Store.job(a));
      return { bothRunning: !!ea[ea.length-1].endedAt === false,
               stoppedNote: ea[ea.length-1].note || '',
               runningNow: Store.running().rec.id === b };
    });
    if (r.bothRunning) throw new Error('two clocks at once');
    if (!/automatically/i.test(r.stoppedNote)) throw new Error('no explanation: '+r.stoppedNote);
    if (!r.runningNow) throw new Error('wrong job running');
    console.log('       "' + r.stoppedNote + '"');
  });
  await t('a run past 8 hours is treated as a forgotten clock-out', async () => {
    await pg.evaluate(() => {
      const r = Store.running(); r.entry.startedAt = Date.now() - 11*3600000; Store.save(); render();
    });
    await pg.waitForTimeout(200);
    if (!await pg.$('#clockbar.stale')) throw new Error('bar not flagged');
    const txt = await pg.$eval('#clockbar', e=>e.textContent);
    if (!/did you forget/i.test(txt)) throw new Error('bar says: '+txt);
    console.log('       ' + txt.replace(/\s+/g,' ').trim().slice(0,70));
  });

  console.log('--- fixing your own mistakes ---');
  await t('an entry can be corrected after the fact', async () => {
    await pg.evaluate(() => { const r = Store.running(); if (r) Store.clockOut(r.kind, r.rec.id); });
    const id = await pg.evaluate(() => Store.data.jobs.find(j=>Store.entriesOf(j).length).id);
    await pg.evaluate(id => openJob(id), id); await pg.waitForTimeout(250);
    await pg.click('.modal [data-edit-time]'); await pg.waitForTimeout(250);
    if (!await pg.$('.modal input[type="datetime-local"]')) throw new Error('no edit fields');
    const was = await pg.evaluate(id => Math.round(Store.totalMs(Store.job(id))/60000), id);
    await pg.evaluate(() => {
      const f = document.querySelectorAll('.modal input[type="datetime-local"]');
      const s = new Date(Date.now()-5*3600000), e = new Date(Date.now()-4*3600000);
      const v = d => new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
      f[0].value = v(s); f[1].value = v(e);
    });
    await pg.click('.modal [data-save-time]'); await pg.waitForTimeout(300);
    const now = await pg.evaluate(id => Math.round(Store.totalMs(Store.job(id))/60000), id);
    if (now === was) throw new Error('edit did nothing ('+now+')');
    console.log('       ' + was + ' min -> ' + now + ' min');
  });
  await t('an entry logged by mistake can be removed', async () => {
    const id = await pg.evaluate(() => Store.data.jobs.find(j=>Store.entriesOf(j).length>1)
      ? Store.data.jobs.find(j=>Store.entriesOf(j).length>1).id
      : Store.data.jobs.find(j=>Store.entriesOf(j).length).id);
    const r = await pg.evaluate(id => {
      const before = Store.entriesOf(Store.job(id)).length;
      Store.removeEntry('job', id, Store.entriesOf(Store.job(id))[0].id);
      return { before, after: Store.entriesOf(Store.job(id)).length };
    }, id);
    if (r.after !== r.before - 1) throw new Error(JSON.stringify(r));
    console.log('       ' + r.before + ' -> ' + r.after + ' entries');
  });
  await t('time can be added by hand for the trip you did not clock', async () => {
    const id = await pg.evaluate(() => Store.data.jobs[3].id);
    await pg.evaluate(id => openJob(id), id); await pg.waitForTimeout(250);
    await pg.click('.modal [data-add-time]'); await pg.waitForTimeout(250);
    const n = await pg.$$eval('.modal input[type="datetime-local"]', e=>e.length);
    if (n !== 2) throw new Error('fields='+n);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
  });

  console.log('--- the estimate carries its own time, then hands it over ---');
  await t('time spent quoting lands on the estimate', async () => {
    const eid = await pg.evaluate(() => Store.data.estimates.find(e=>e.status!=='approved').id);
    const mins = await pg.evaluate(eid => {
      Store.addEntry('estimate', eid, Date.now()-2*3600000, Date.now()-2*3600000 + 40*60000, '');
      return Math.round(Store.totalMs(Store.estimate(eid))/60000);
    }, eid);
    if (mins !== 40) throw new Error('mins='+mins);
    await pg.evaluate(eid => openEstimate(eid), eid); await pg.waitForTimeout(250);
    const txt = await pg.$eval('.modal', e=>e.textContent);
    if (!/Time quoting/.test(txt)) throw new Error('no quoting panel on the estimate');
    if (!/40m/.test(txt)) throw new Error('panel does not show 40m');
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
    console.log('       40m on the estimate');
  });
  await t('converting to a job carries the quoting time into the all-in total', async () => {
    const eid = await pg.evaluate(() => Store.data.estimates.find(e => Store.totalMs(e) > 0 && e.status !== 'approved').id);
    await pg.evaluate(eid => {
      Store.convertEstimate(Store.estimate(eid), { customerId: Store.data.customers[0].id,
        scheduledDate: todayStr(), window: 'Anytime', priority: 'Normal' });
    }, eid);
    await pg.waitForTimeout(300);
    const r = await pg.evaluate(eid => {
      const j = Store.data.jobs.find(x => x.estimateId === eid);
      if (!j) return { none:true };
      Store.addEntry('job', j.id, Date.now()-3600000, Date.now()-3600000 + 90*60000, '');
      return { onSite: Math.round(Store.totalMs(j)/60000), allIn: Math.round(Store.jobTotalMs(j)/60000) };
    }, eid);
    if (r.none) throw new Error('conversion produced no linked job');
    if (r.onSite !== 90) throw new Error('on site='+r.onSite);
    if (r.allIn !== 130) throw new Error('all in='+r.allIn+' (wanted 90 + 40)');
    console.log('       90m on site + 40m quoting = ' + r.allIn + 'm all in');
  });
  await t('the job record shows the carried-over quote time as its own line', async () => {
    const jid = await pg.evaluate(() => Store.data.jobs.find(j => j.estimateId && Store.jobTotalMs(j) > Store.totalMs(j)).id);
    await pg.evaluate(jid => openJob(jid), jid); await pg.waitForTimeout(250);
    const txt = await pg.$eval('.modal', e=>e.textContent.replace(/\s+/g,' '));
    if (!/quoting it/i.test(txt)) throw new Error('no quoting line');
    if (!/All in/i.test(txt)) throw new Error('no all-in total');
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
    console.log('       "Plus quoting it" + "All in" both shown');
  });

  console.log('--- is the flat rate working ---');
  await t('effective rate is billed over hours actually clocked', async () => {
    await reset();
    await pg.evaluate(() => {
      Store.data.settings.laborRate = 150;
      const mk = (type, hrs, price, daysAgo) => {
        const j = Store.data.jobs[0];
        const n = JSON.parse(JSON.stringify(j));
        n.id = 'J-t' + Math.random().toString(36).slice(2,7);
        n.type = type; n.status = 'complete';
        n.scheduledDate = addDays(todayStr(), -daysAgo);
        n.parts = [{ desc:'flat rate', qty:1, price }];
        n.laborHours = 0; n.laborRate = 0;
        n.timeEntries = [{ id:'e'+Math.random().toString(36).slice(2,7),
          startedAt: Date.now() - daysAgo*86400000, endedAt: Date.now() - daysAgo*86400000 + hrs*3600000 }];
        Store.data.jobs.push(n);
      };
      Store.data.jobs.forEach(j => { j.status = 'scheduled'; j.timeEntries = []; });
      mk('Drain Cleaning', 2, 400, 10);   // 200/hr
      mk('Drain Cleaning', 2, 400, 20);   // 200/hr
      mk('Water Heater', 5, 500, 15);     // 100/hr  <- thin
      mk('Boiler / Radiant Heat', 1, 90, 30); // 90/hr <- bad
      mk('Fixture Install', 2, 240, 150); // 120/hr <- thin, only in the 6mo+ window
      mk('Gas Line', 3, 600, 200);        // outside 6 months
      Store.save(); go('timemoney');
    });
    await pg.waitForTimeout(350);
    const rows = await pg.$$eval('.card table tbody tr', rs => rs.map(r =>
      [...r.querySelectorAll('td')].map(c => c.textContent.trim())));
    const by = {}; rows.forEach(r => by[r[0]] = r);
    if (!by['Drain Cleaning']) throw new Error('rows: '+JSON.stringify(rows));
    if (by['Drain Cleaning'][6] !== '$200.00/hr') throw new Error('drain rate '+by['Drain Cleaning'][6]);
    if (by['Water Heater'][6] !== '$100.00/hr') throw new Error('wh rate '+by['Water Heater'][6]);
    if (by['Gas Line']) throw new Error('a job from 200 days ago leaked into the 3-month window');
    console.log('       drain $200/hr · water heater $100/hr · gas line correctly out of range');
  });
  await t('the thinnest work is listed first', async () => {
    const first = await pg.$eval('.card table tbody tr td', e=>e.textContent.trim());
    if (first !== 'Boiler / Radiant Heat') throw new Error('top row is '+first);
    console.log('       boiler at $90/hr sits at the top');
  });
  await t('rates are coloured against the target, not guessed', async () => {
    await pg.click('[data-money-range="365"]'); await pg.waitForTimeout(300);
    const cls = await pg.$$eval('.card table tbody tr td:last-child', cs =>
      cs.map(c => [c.textContent.trim(), c.className]));
    const find = r => (cls.find(c => c[0] === r) || [])[1] || '';
    if (!find('$90.00/hr').includes('rate-bad')) throw new Error('90/hr not red: '+find('$90.00/hr'));
    if (!find('$100.00/hr').includes('rate-bad')) throw new Error('100/hr not red: '+find('$100.00/hr'));
    if (!find('$120.00/hr').includes('rate-thin')) throw new Error('120/hr not amber: '+find('$120.00/hr'));
    if (!find('$200.00/hr').includes('rate-good')) throw new Error('200/hr not green');
    await pg.click('[data-money-range="90"]'); await pg.waitForTimeout(300);
    console.log('       $90 and $100 red · $120 amber · $200 green against a $150 target');
  });
  await t('it says in plain money what the thin work would have to charge', async () => {
    const txt = await pg.$eval('.callout', e=>e.textContent.replace(/\s+/g,' '));
    if (!/Boiler/.test(txt)) throw new Error(txt);
    if (!/\$150\.00/.test(txt) || !/\$90\.00/.test(txt)) throw new Error('no before/after price: '+txt);
    console.log('       ' + txt.trim().slice(0,110));
  });
  await t('the range buttons change the window', async () => {
    await pg.click('[data-money-range="365"]'); await pg.waitForTimeout(300);
    const has = await pg.$$eval('.card table tbody tr td:first-child', cs=>cs.map(c=>c.textContent.trim()));
    if (!has.includes('Gas Line')) throw new Error('1 year still missing the 200-day job: '+has);
    await pg.click('[data-money-range="30"]'); await pg.waitForTimeout(300);
    const near = await pg.$$eval('.card table tbody tr td:first-child', cs=>cs.map(c=>c.textContent.trim()));
    if (near.includes('Water Heater') === false && near.length === 0) throw new Error('30 days empty');
    console.log('       1 year picks up the old job, 30 days narrows to ' + near.length + ' row(s)');
  });
  await t('it refuses to let you re-price off four jobs', async () => {
    await pg.click('[data-money-range="90"]'); await pg.waitForTimeout(300);
    const warn = await pg.$eval('.legal-note', e=>e.textContent.replace(/\s+/g,' ')).catch(()=>'');
    if (!/not enough/i.test(warn)) throw new Error('no small-sample warning: '+warn);
    console.log('       "' + warn.trim().slice(0,90) + '"');
  });
  await t('jobs with no time logged are counted, not quietly dropped', async () => {
    await pg.evaluate(() => {
      const j = JSON.parse(JSON.stringify(Store.data.jobs[0]));
      j.id='J-notime'; j.status='complete'; j.scheduledDate=addDays(todayStr(),-5); j.timeEntries=[];
      Store.data.jobs.push(j); Store.save(); render();
    });
    await pg.waitForTimeout(300);
    const txt = await pg.$eval('.stat-row', e=>e.textContent.replace(/\s+/g,' '));
    if (!/no time logged/.test(txt)) throw new Error(txt);
    console.log('       untimed jobs disclosed on the billed tile');
  });
  await t('hours lost to quotes that went nowhere are priced', async () => {
    await pg.evaluate(() => {
      const e = Store.data.estimates[0];
      e.status = 'declined'; e.createdAt = Date.now() - 20*86400000;
      e.timeEntries = [{ id:'q1', startedAt: Date.now()-20*86400000, endedAt: Date.now()-20*86400000 + 90*60000 }];
      Store.save(); render();
    });
    await pg.waitForTimeout(300);
    const txt = await pg.$eval('.card .card-body', e=>e.textContent.replace(/\s+/g,' '));
    if (!/1\.5h/.test(txt)) throw new Error('lost hours not shown: '+txt);
    if (!/\$225\.00/.test(txt)) throw new Error('1.5h at $150 should read $225: '+txt);
    console.log('       1.5h lost quoting = $225.00 of his time');
  });
  await t('the view explains that this is not profit', async () => {
    const txt = await pg.$eval('#view', e=>e.textContent);
    if (!/isn't profit|not profit/i.test(txt)) throw new Error('no caveat');
    if (!/fuel|insurance|truck/i.test(txt)) throw new Error('caveat does not say what comes out of it');
    console.log('       fuel, insurance and the truck named');
  });
  await t('an empty window says what to do instead of showing zeros', async () => {
    await pg.evaluate(() => localStorage.clear());
    await pg.reload(); await pg.waitForTimeout(400);
    await pg.evaluate(() => { Store.data.jobs.forEach(j=>j.timeEntries=[]); Store.save(); go('timemoney'); });
    await pg.waitForTimeout(350);
    const txt = await pg.$eval('#view', e=>e.textContent);
    if (!/Clock in when you get to a job/.test(txt)) throw new Error('no guidance in the empty state');
    console.log('       tells him to clock in');
  });

  console.log('--- parts cost ---');
  await t('until he enters parts costs, the view says so in plain words', async () => {
    await pg.evaluate(() => {
      localStorage.clear();
    });
    await pg.reload(); await pg.waitForTimeout(400);
    await pg.evaluate(() => {
      Store.data.settings.laborRate = 150;
      const j = Store.data.jobs[0];
      j.status='complete'; j.scheduledDate = addDays(todayStr(),-3);
      j.parts=[{desc:'water heater, installed', qty:1, price:2250}]; j.laborHours=0; j.laborRate=0;
      j.timeEntries=[{id:'x1', startedAt:Date.now()-5*3600000, endedAt:Date.now()-3600000}];
      Store.save(); go('timemoney');
    });
    await pg.waitForTimeout(350);
    const txt = await pg.$eval('#view', e=>e.textContent.replace(/\s+/g,' '));
    if (!/don't know what your parts cost you/.test(txt)) throw new Error('no warning');
    const rate = await pg.$eval('.card table tbody tr td:last-child', e=>e.textContent.trim());
    if (rate !== '$562.50/hr') throw new Error('gross rate '+rate);
    console.log('       $2,250 over 4h reads $562.50/hr, flagged as not knowing parts cost');
  });
  await t('entering the parts cost turns the gross number into a real one', async () => {
    await pg.evaluate(() => { Store.data.jobs[0].materialCost = 1400; Store.save(); render(); });
    await pg.waitForTimeout(300);
    const rate = await pg.$eval('.card table tbody tr td:last-child', e=>e.textContent.trim());
    if (rate !== '$212.50/hr') throw new Error('net rate '+rate+' (wanted (2250-1400)/4)');
    const head = await pg.$$eval('.card table thead th', hs=>hs.map(h=>h.textContent.trim()));
    if (!head.includes('Parts cost')) throw new Error('no parts column: '+head);
    const txt = await pg.$eval('#view', e=>e.textContent.replace(/\s+/g,' '));
    if (/don't know what your parts cost you/.test(txt)) throw new Error('warning still up');
    if (!/Kept after parts/.test(txt)) throw new Error('tile still says Billed');
    console.log('       $562.50/hr -> $212.50/hr once he says the tank cost him $1,400');
  });
  await t('the parts-cost box is on the job record and saves', async () => {
    const id = await pg.evaluate(() => Store.data.jobs[0].id);
    await pg.evaluate(id => openJob(id), id); await pg.waitForTimeout(300);
    const v = await pg.$eval('#mat-cost', e=>e.value);
    if (v !== '1400') throw new Error('field shows '+v);
    await pg.fill('#mat-cost', '1555');
    await pg.click('[data-save-matcost]'); await pg.waitForTimeout(300);
    const saved = await pg.evaluate(id => Store.job(id).materialCost, id);
    if (saved !== 1555) throw new Error('saved '+saved);
    const txt = await pg.$eval('.modal', e=>e.textContent.replace(/\s+/g,' '));
    if (!/leaves \$695\.00/.test(txt)) throw new Error('no "leaves" figure: '+txt.slice(0,200));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
    console.log('       saved, and the row reads "leaves $695.00"');
  });

  console.log('--- nav ---');
  await t('Time & Money is reachable from the sidebar and on a phone', async () => {
    if (!await pg.$('[data-nav="timemoney"]')) throw new Error('not in sidebar');
    await pg.setViewportSize({ width:390, height:844 }); await pg.waitForTimeout(300);
    await pg.click('[data-action="more"]').catch(()=>{});
    await pg.waitForTimeout(250);
    const found = await pg.$$eval('[data-nav="timemoney"]', e=>e.length);
    if (!found) throw new Error('not reachable on a phone');
    await pg.setViewportSize({ width:1500, height:1100 }); await pg.waitForTimeout(250);
  });

  await b.close();
  const hard = errs.filter(e=>e.includes('CONSOLE')||e.includes('PAGEERROR'));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
