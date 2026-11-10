/* Time entries that say what they were, and time that has no clock times.

   From real use: on one job he drove 1:45–2:15 to the wholesaler and worked
   2:15–4:15, and the entries couldn't carry that split. And he had half an
   hour of quoting on an estimate with no Arrived/Left to give it, so it
   couldn't be entered at all without making times up. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP=`file://${REPO_DIR}/index.html`, errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1500,height:1100} });
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await pg.goto(APP); await pg.waitForTimeout(500);

  const reset = async () => {
    await pg.evaluate(()=>localStorage.clear()); await pg.reload(); await pg.waitForTimeout(400);
    await pg.evaluate(() => {
      const r = Store.running(); if (r) Store.clockOut(r.kind, r.rec.id);
      Store.data.jobs.forEach(j => j.timeEntries = []);
      Store.data.estimates.forEach(e => e.timeEntries = []);
      Store.save();
    });
  };
  /* Today at h:mm, as the datetime-local box wants it. */
  const at = (h, m) => pg.evaluate(([h,m]) => {
    const d = new Date(); d.setHours(h, m, 0, 0); return toLocalInput(d.getTime());
  }, [h, m]);
  const openAdd = async (kind, id) => {
    await pg.evaluate(([k,id]) => k === 'estimate' ? openEstimate(id) : openJob(id), [kind, id]);
    await pg.waitForTimeout(250);
    await pg.click('.modal [data-add-time]'); await pg.waitForTimeout(250);
  };
  const rows = () => pg.$$eval('.modal .time-row', rs => rs.map(r => r.textContent.replace(/\s+/g,' ').trim()));
  const save = async () => { await pg.click('.modal [data-save-time]'); await pg.waitForTimeout(300); };

  console.log('--- saying what the time was ---');
  let jid;
  await t('the time dialog has a box for what the block was, with quick picks', async () => {
    await reset();
    jid = await pg.evaluate(() => Store.data.jobs[0].id);
    await openAdd('job', jid);
    if (!await pg.$('.modal #te-label')) throw new Error('no label box');
    const picks = await pg.$$eval('.modal [data-te-pick]', bs => bs.map(b => b.textContent.trim()));
    for (const w of ['Work time','Driving','Wholesaler run','Dump run','Quoting','Subcontractor'])
      if (!picks.includes(w)) throw new Error('missing pick '+w+': '+picks);
    console.log('       picks: ' + picks.join(', '));
  });
  await t('a drive to the wholesaler and the work after it are two labelled entries on one job', async () => {
    await pg.fill('#te-start', await at(13,45)); await pg.fill('#te-end', await at(14,15));
    await pg.click('.modal [data-te-pick="Wholesaler run"]');
    if (await pg.$eval('#te-label', e=>e.value) !== 'Wholesaler run') throw new Error('tap did not fill the box');
    await save();
    await pg.click('.modal [data-add-time]'); await pg.waitForTimeout(250);
    await pg.fill('#te-start', await at(14,15)); await pg.fill('#te-end', await at(16,15));
    await pg.fill('#te-label', 'work time');
    await save();
    const r = await rows();
    const drive = r.find(x => /Wholesaler run/.test(x)), work = r.find(x => /work time/.test(x));
    if (!drive || !/30m/.test(drive)) throw new Error('drive row: '+JSON.stringify(r));
    if (!work || !/2h/.test(work)) throw new Error('work row: '+JSON.stringify(r));
    const txt = await pg.$eval('.modal', e=>e.textContent.replace(/\s+/g,' '));
    if (!/Time on this job 2h 30m/.test(txt)) throw new Error('total wrong: '+txt.slice(0,300));
    const stored = await pg.evaluate(id => Store.entriesOf(Store.job(id)).map(e => e.label), jid);
    if (JSON.stringify(stored) !== '["Wholesaler run","work time"]') throw new Error('stored '+JSON.stringify(stored));
    console.log('       ' + drive + '  |  ' + work);
  });
  await t('an entry he did not label stays unlabelled — nothing guesses "Work time"', async () => {
    await pg.click('.modal [data-add-time]'); await pg.waitForTimeout(250);
    await pg.fill('#te-start', await at(9,0)); await pg.fill('#te-end', await at(10,0));
    await save();
    const e = await pg.evaluate(id => Store.entriesOf(Store.job(id)).find(x => !x.label), jid);
    if (!e) throw new Error('every entry got a label');
    if ('label' in e) throw new Error('label key written: '+JSON.stringify(e));
  });
  await t('a label he typed himself comes back as a pick next time', async () => {
    await pg.evaluate(id => Store.addEntry('job', id, Date.now()-7200000, Date.now()-3600000, '', { label:'Picked up Rheem tank' }), jid);
    await openAdd('job', jid);
    const picks = await pg.$$eval('.modal [data-te-pick]', bs => bs.map(b => b.textContent.trim()));
    if (!picks.includes('Picked up Rheem tank')) throw new Error(picks.join(', '));
    if (picks.filter(p => p.toLowerCase() === 'work time').length !== 1) throw new Error('"work time" listed twice: '+picks);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
  });
  await t('correcting an entry keeps its label, and clearing the box removes it', async () => {
    await pg.evaluate(id => openJob(id), jid); await pg.waitForTimeout(250);
    const eid = await pg.evaluate(id => Store.entriesOf(Store.job(id)).find(e => e.label === 'Wholesaler run').id, jid);
    await pg.click(`.modal [data-edit-time$=":${eid}"]`); await pg.waitForTimeout(250);
    if (await pg.$eval('#te-label', e=>e.value) !== 'Wholesaler run') throw new Error('label not offered back');
    await pg.fill('#te-label', '');
    await save();
    const e = await pg.evaluate(([id,eid]) => Store.entriesOf(Store.job(id)).find(x => x.id === eid), [jid, eid]);
    if (e.label) throw new Error('label survived being cleared: '+e.label);
  });
  await t('labelling an entry the app stopped leaves its "stopped automatically" note alone', async () => {
    const [a, b2] = await pg.evaluate(() => Store.data.jobs.slice(1,3).map(j => j.id));
    /* Back-date the first clock an hour: a run of a few milliseconds shows as
       the same minute in both boxes, and the dialog rightly refuses that. */
    await pg.evaluate(([a,b2]) => {
      Store.clockIn('job', a); Store.running().entry.startedAt = Date.now() - 3600000;
      Store.clockIn('job', b2); Store.clockOut('job', b2);
    }, [a, b2]);
    await pg.evaluate(a => openJob(a), a); await pg.waitForTimeout(250);
    await pg.click('.modal [data-edit-time]'); await pg.waitForTimeout(250);
    await pg.fill('#te-label', 'Dump run');
    await save();
    const e = await pg.evaluate(a => Store.entriesOf(Store.job(a))[0], a);
    if (e.label !== 'Dump run') throw new Error('label '+e.label);
    if (!/automatically/i.test(e.note || '')) throw new Error('note lost: '+e.note);
    const r = await rows();
    if (!r.some(x => /Dump run/.test(x) && /automatically/i.test(x))) throw new Error(JSON.stringify(r));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
  });

  console.log('--- time with no clock times ---');
  let eid;
  await t('half an hour of quoting goes on an estimate without inventing Arrived and Left', async () => {
    await reset();
    eid = await pg.evaluate(() => Store.data.estimates.find(e => e.status !== 'approved').id);
    await openAdd('estimate', eid);
    await pg.click('.modal [data-te-mode="dur"]'); await pg.waitForTimeout(100);
    if (await pg.$eval('#te-clock', e=>getComputedStyle(e).display) !== 'none') throw new Error('Arrived/Left still showing');
    await pg.fill('#te-hours', '0.5');
    await pg.click('.modal [data-te-pick="Quoting"]');
    await save();
    const txt = await pg.$eval('.modal', e=>e.textContent.replace(/\s+/g,' '));
    if (!/Time quoting 30m/.test(txt)) throw new Error('total: '+txt.slice(0,300));
    const r = await rows();
    const row = r.find(x => /Quoting/.test(x));
    if (!row || !/no clock times/.test(row)) throw new Error('row: '+JSON.stringify(r));
    if (/\d:\d\d/.test(row)) throw new Error('a clock time is showing: '+row);
    console.log('       ' + row);
  });
  await t('a bare duration is not a clock left running', async () => {
    const r = await pg.evaluate(() => ({ running: !!Store.running(), stale: !!Store.staleRunning() }));
    if (r.running || r.stale) throw new Error(JSON.stringify(r));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
    if (await pg.$('#clockbar.on')) throw new Error('running bar is up');
  });
  await t('reopening it shows the hours again, not a made-up midnight start', async () => {
    await pg.evaluate(id => openEstimate(id), eid); await pg.waitForTimeout(250);
    await pg.click('.modal [data-edit-time]'); await pg.waitForTimeout(250);
    if (await pg.$eval('#te-dur', e=>getComputedStyle(e).display) === 'none') throw new Error('opened in clock mode');
    const v = await pg.$eval('#te-hours', e=>e.value);
    if (v !== '0.5') throw new Error('hours shows '+v);
    const day = await pg.$eval('#te-day', e=>e.value);
    if (day !== await pg.evaluate(() => todayStr())) throw new Error('day '+day);
    const start = await pg.$eval('#te-start', e=>e.value);
    if (/T00:00$/.test(start)) throw new Error('midnight anchor offered as Arrived: '+start);
  });
  await t('1:30 reads as an hour and a half, and a nonsense number is refused', async () => {
    for (const bad of ['abc', '0', '25', '-1']){
      await pg.fill('#te-hours', bad); await save();
      if (!await pg.$('.modal #te-err')) throw new Error('dialog closed on '+bad);
      const shown = await pg.$eval('#te-err', e=>getComputedStyle(e).display !== 'none' && e.textContent);
      if (!shown) throw new Error('no error for '+bad);
    }
    const still = await pg.evaluate(id => Math.round(Store.totalMs(Store.estimate(id))/60000), eid);
    if (still !== 30) throw new Error('a refused value changed the record: '+still);
    await pg.fill('#te-hours', '1:30'); await save();
    const mins = await pg.evaluate(id => Math.round(Store.totalMs(Store.estimate(id))/60000), eid);
    if (mins !== 90) throw new Error('mins='+mins);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
  });
  await t('quoting time with no clock times still carries into the job it became', async () => {
    await pg.evaluate(id => {
      Store.convertEstimate(Store.estimate(id), { customerId: Store.data.customers[0].id,
        scheduledDate: todayStr(), window: 'Anytime', priority: 'Normal' });
    }, eid);
    await pg.waitForTimeout(300);
    const r = await pg.evaluate(id => {
      const j = Store.data.jobs.find(x => x.estimateId === id);
      return j && Math.round(Store.jobTotalMs(j)/60000);
    }, eid);
    if (r !== 90) throw new Error('all-in '+r);
  });
  await t('a running clock can only be stopped from the dialog, not turned into a duration', async () => {
    const id = await pg.evaluate(() => Store.data.jobs[0].id);
    await pg.evaluate(id => { Store.clockIn('job', id); openJob(id); }, id); await pg.waitForTimeout(250);
    await pg.click('.modal [data-edit-time]'); await pg.waitForTimeout(250);
    if (await pg.$('.modal [data-te-mode]')) throw new Error('duration switch offered on a running clock');
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
    await pg.evaluate(id => Store.clockOut('job', id), id);
  });

  await b.close();
  const hard = errs.filter(e=>e.includes('CONSOLE')||e.includes('PAGEERROR'));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
