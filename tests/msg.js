const { chromium } = require(process.env.PW || 'playwright-core');
const APP=`file://${APP}/index.html`, SHOTS=process.env.SP+'/shots', errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const ph = await b.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  ph.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  ph.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await ph.goto(APP); await ph.waitForTimeout(500);

  console.log('--- from the field card ---');
  await t('every stop offers a Text button', async () => {
    const stops = await ph.$$eval('.stop .stop-acts', e=>e.length);
    const texts = await ph.$$eval('.stop [data-message]', e=>e.length);
    if (!stops || texts !== stops) throw new Error(texts+' text buttons for '+stops+' actionable stops');
  });
  await t('sheet opens with the on-my-way message filled in', async () => {
    await ph.click('.stop [data-message]'); await ph.waitForTimeout(400);
    const body = await ph.inputValue('#msg-body');
    if (/\{\{/.test(body)) throw new Error('unmerged field: '+body);
    if (!/Poseidon Plumbing & Gasfitting/.test(body)) throw new Error('no company');
    if (/Ltd\.\./.test(body)) throw new Error('double full stop: '+body);
    if (/Ltd\./.test(body)) throw new Error('legal suffix in a text: '+body);
    if (!/about 30 minutes/.test(body)) throw new Error('no zone ETA: '+body);
    console.log('       "' + body + '"');
  });
  await t('first name only, not the whole name', async () => {
    const body = await ph.inputValue('#msg-body');
    if (/Hi Holly Bennett/.test(body)) throw new Error('used the full name');
    if (!/Hi Holly —/.test(body)) throw new Error('first name missing: '+body);
  });
  await t('the sms link carries the message and the number', async () => {
    const href = await ph.getAttribute('#msg-sms','href');
    if (!href.startsWith('sms:7805550231?&body=')) throw new Error('href: '+href.slice(0,60));
    const sent = decodeURIComponent(href.split('body=')[1]);
    if (sent !== await ph.inputValue('#msg-body')) throw new Error('link text differs from preview');
  });
  await t('+30 changes the ETA wording', async () => {
    await ph.click('[data-msg-bump="30"]'); await ph.waitForTimeout(350);
    const body = await ph.inputValue('#msg-body');
    // 30 + 30 should read as a time, and fit "... {{eta}} out."
    if (!/about an hour out/.test(body)) throw new Error('bumped wording: '+body);
    if (/more than planned/.test(body)) throw new Error('delta phrasing leaked in');
    const href = decodeURIComponent(await ph.getAttribute('#msg-sms','href'));
    if (!/about an hour/.test(href)) throw new Error('link did not follow the bump');
    console.log('       bumped: "' + body + '"');
  });
  await ph.screenshot({ path: SHOTS+'/m1-send.png' });
  await t('editing the text updates the link', async () => {
    await ph.fill('#msg-body','Custom note, side gate please.');
    await ph.waitForTimeout(250);
    const href = decodeURIComponent(await ph.getAttribute('#msg-sms','href'));
    if (!/side gate please/.test(href)) throw new Error('href stale: '+href);
    const count = await ph.textContent('#msg-count');
    if (!/30 characters/.test(count)) throw new Error('count: '+count);
  });
  await t('switching template re-renders from the template', async () => {
    await ph.click('[data-msg-tpl="late"]'); await ph.waitForTimeout(350);
    const body = await ph.inputValue('#msg-body');
    if (/side gate/.test(body)) throw new Error('kept the edit across templates');
    if (!/Running behind/.test(body)) throw new Error(body);
  });
  await t('Booked and Finished templates read right', async () => {
    await ph.click('[data-msg-tpl="confirm"]'); await ph.waitForTimeout(300);
    const booked = await ph.inputValue('#msg-body');
    if (/\{\{/.test(booked)) throw new Error('unmerged: '+booked);
    if (!/today/.test(booked)) throw new Error('day word missing: '+booked);
    console.log('       "' + booked + '"');
    await ph.click('[data-msg-tpl="done"]'); await ph.waitForTimeout(300);
    const done = await ph.inputValue('#msg-body');
    if (/\{\{/.test(done)) throw new Error('unmerged: '+done);
    if (!await ph.isVisible('.msg-eta') === false) { /* eta row hidden for done — fine */ }
  });
  await t('no ETA row on templates that do not need one', async () => {
    if (await ph.$('.msg-eta')) throw new Error('ETA row shown on Finished');
    await ph.click('[data-msg-tpl="onway"]'); await ph.waitForTimeout(300);
    if (!await ph.$('.msg-eta')) throw new Error('ETA row missing on On my way');
  });
  await t('handing it to the phone asks first, and logs nothing yet', async () => {
    await ph.click('[data-msg-send="copy"]'); await ph.waitForTimeout(400);
    const r = await ph.evaluate(() => ({
      asked: !!document.querySelector('[data-msg-went="yes"]'),
      logged: Store.data.jobs.some(j =>
        (j.log||[]).some(l => /message for|^Texted|^Emailed/.test(l.text))) }));
    if (!r.asked) throw new Error('did not ask whether it went');
    if (r.logged) throw new Error('logged a send before he said it went');
  });

  await t('saying it went is what writes it to the job log', async () => {
    await ph.click('[data-msg-went="yes"]'); await ph.waitForTimeout(400);
    const logged = await ph.evaluate(() =>
      Store.data.jobs.some(j => (j.log||[]).some(l => /message for|^Texted|^Emailed/.test(l.text))));
    if (!logged) throw new Error('nothing logged after saying yes');
  });

  await t('ETA bumps read as times, for every shape of zone phrase', async () => {
    const got = await ph.evaluate(() => ({
      none:   Store.bumpEta('about 30 minutes', 0),
      p15:    Store.bumpEta('about 30 minutes', 15),
      p30:    Store.bumpEta('about 30 minutes', 30),
      from45: Store.bumpEta('about 45 minutes', 15),
      odd:    Store.bumpEta('about 45 minutes', 30),
      words:  Store.bumpEta('about an hour', 30),
      range:  Store.bumpEta('20-25 min', 15)
    }));
    const want = { none:'about 30 minutes', p15:'about 45 minutes', p30:'about an hour',
                   from45:'about an hour', odd:'about 75 minutes',
                   words:'about an hour, plus about 30 minutes', range:'35-40 min' };
    for (const k of Object.keys(want))
      if (got[k] !== want[k]) throw new Error();
    if (Object.values(got).some(v => /minutes minutes|NaN|undefined/.test(v)))
      throw new Error('mangled output: '+JSON.stringify(got));
  });

  console.log('--- zones ---');
  const pc = await b.newPage({ viewport:{width:1400,height:1000} });
  pc.on('pageerror',e=>errs.push('PAGEERROR(desktop): '+e.message));
  await pc.goto(APP); await pc.waitForTimeout(500);
  await t('out-of-city customer gets the longer ETA', async () => {
    const out = await pc.evaluate(() => {
      const c = Store.data.customers.find(x => x.zone === 'greater');
      const j = Store.data.jobs.find(x => x.customerId === c.id);
      return { name:c.name, msg: Store.renderMessage('onway', j, 0) };
    });
    if (!/about 45 minutes/.test(out.msg)) throw new Error(out.msg);
    console.log('       ' + out.name + ': "' + out.msg + '"');
  });
  await t('zone is editable on the customer and shows on the record', async () => {
    await pc.click('[data-nav="customers"]'); await pc.waitForTimeout(350);
    await pc.click('tr:has-text("Holly Bennett")'); await pc.waitForTimeout(350);
    if (!(await pc.textContent('.modal')).includes('about 30 minutes')) throw new Error('no zone chip');
    await pc.click('[data-edit-customer]'); await pc.waitForTimeout(350);
    await pc.selectOption('#c-zone','out');
    await pc.click('[data-save-customer]'); await pc.waitForTimeout(400);
    const z = await pc.evaluate(() => Store.data.customers.find(c=>c.name==='Holly Bennett').zone);
    if (z !== 'out') throw new Error('zone='+z);
  });
  await t('editing a zone ETA flows into the message', async () => {
    await pc.click('[data-nav="data"]'); await pc.waitForTimeout(350);
    await pc.click('[data-action="edit-messages"]'); await pc.waitForTimeout(400);
    await pc.fill('[data-zone-eta="city"]','about 20 minutes');
    await pc.fill('[data-zone-label="greater"]','St. Albert & area');
    await pc.click('[data-save-messages]'); await pc.waitForTimeout(400);
    const out = await pc.evaluate(() => {
      const c = Store.data.customers.find(x => x.zone === 'city');
      const j = Store.data.jobs.find(x => x.customerId === c.id);
      return j ? Store.renderMessage('onway', j, 0) : Store.zone('city').eta;
    });
    if (!/about 20 minutes/.test(out)) throw new Error(out);
    const lbl = await pc.evaluate(() => Store.zone('greater').label);
    if (lbl !== 'St. Albert & area') throw new Error('label='+lbl);
  });
  await t('an edited template is used and survives reload', async () => {
    await pc.click('[data-action="edit-messages"]'); await pc.waitForTimeout(400);
    await pc.fill('[data-msg-body="onway"]','{{tech}} here, rolling up in {{eta}}.');
    await pc.click('[data-save-messages]'); await pc.waitForTimeout(400);
    await pc.reload(); await pc.waitForTimeout(500);
    const msg = await pc.evaluate(() => {
      const j = Store.data.jobs.find(x => x.customerId === Store.data.customers.find(c=>c.zone==='city').id);
      return j ? Store.renderMessage('onway', j, 0) : null;
    });
    if (!msg || !/rolling up in about 20 minutes/.test(msg)) throw new Error(msg);
    console.log('       "' + msg + '"');
  });
  await t('old saved data gets zones and templates backfilled', async () => {
    await pc.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('pcp.dispatch.v1'));
      delete d.settings.zones; delete d.settings.messages;
      d.customers.forEach(c => delete c.zone);
      localStorage.setItem('pcp.dispatch.v1', JSON.stringify(d));
    });
    await pc.reload(); await pc.waitForTimeout(500);
    const r = await pc.evaluate(() => ({
      zones: Store.zones().length,
      ids: Store.messages().map(m => m.id),
      zoned: Store.data.customers.every(c => c.zone) }));
    if (r.zones !== 3) throw new Error('zones: ' + r.zones);
    if (!r.zoned) throw new Error('customers lost their zone');
    for (const want of ["confirm","reminder","onway","late","done"])
      if (!r.ids.includes(want)) throw new Error('missing ' + want + ': ' + JSON.stringify(r.ids));
    if (r.ids.length !== new Set(r.ids).size) throw new Error('duplicated: ' + JSON.stringify(r.ids));
  });
  await pc.screenshot({ path: SHOTS+'/m2-setup.png' });

  await b.close();
  const hard = errs.filter(e=>e.includes('CONSOLE')||e.includes('PAGEERROR'));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
