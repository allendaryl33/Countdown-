const { chromium } = require(process.env.PW || 'playwright-core');
const URL_='http://127.0.0.1:54321', KEY='sb_publishable_test', errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:390,height:844} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await fetch(URL_+'/__reset');
  await pg.goto(URL_+'/index.html'); await pg.waitForTimeout(400);
  await pg.evaluate(([u,k]) => {
    Cloud.cfg = { url:u, key:k, email:'', deviceId:'Phone-x' }; Cloud.saveCfg();
    return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow());
  }, [URL_, KEY]);
  await pg.waitForTimeout(800);

  const typeInto = async (id, text) => {
    await pg.evaluate(() => go('data')); await pg.waitForTimeout(350);
    await pg.fill(id, '');
    await pg.click(id);
    await pg.keyboard.type(text);
  };
  const state = id => pg.evaluate(sel => ({
    v: (document.querySelector(sel)||{}).value,
    focus: document.activeElement.id || document.activeElement.tagName
  }), id);

  console.log('--- a field being typed into survives the background ---');
  const cases = [
    ['a sync landing',              () => pg.evaluate(() => Cloud.syncNow({quiet:true}))],
    ['the app being switched away', () => pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))],
    ['the signal coming back',      () => pg.evaluate(() => window.dispatchEvent(new Event('online')))],
    ['something else saving',       () => pg.evaluate(() => { Store.data.jobs[0].priority='High'; Store.save(); })],
    ['another device pushing a change', () => pg.evaluate(async () => {
        await fetch('http://127.0.0.1:54321/__poison'); return Cloud.syncNow({quiet:true}); })]
  ];
  for (const [label, trigger] of cases){
    await t(label + ' does not wipe it', async () => {
      await typeInto('#set-phone', '7805551234');
      await trigger();
      await pg.waitForTimeout(800);
      const s = await state('#set-phone');
      if (s.v !== '7805551234') throw new Error('became "' + s.v + '"');
      if (s.focus !== 'set-phone') throw new Error('focus jumped to ' + s.focus);
    });
  }

  // the last case deliberately causes a real conflict, which opens the
  // dialog by design. Clear it and start the next section from a clean sync.
  await t('that conflict did open the dialog, as it should', async () => {
    const seen = await pg.evaluate(() => !!document.querySelector('.modal'));
    if (!seen) throw new Error('no conflict dialog after a competing write');
    await pg.evaluate(() => { closeModal(); Cloud._conflictRemote = null; });
    await fetch(URL_+'/__reset');
    await pg.evaluate(() => {
      Cloud.state = 'signed-out'; Cloud.baseRev = 0; Cloud.dirty = false;
      return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow());
    });
    await pg.waitForTimeout(900);
    const st = await pg.evaluate(() => Cloud.state);
    if (st !== 'synced') throw new Error('could not get back to synced: ' + st);
    console.log('       dialog shown, then cleared back to synced');
  });

  console.log('--- and the rest still works ---');
  await t('a number typed without interruption saves and sticks', async () => {
    await typeInto('#set-phone', '(780) 414-9900');
    await pg.click('[data-action="save-settings"]'); await pg.waitForTimeout(3200);
    await pg.reload(); await pg.waitForTimeout(1200);
    const v = await pg.evaluate(() => Store.data.settings.phone);
    if (v !== '(780) 414-9900') throw new Error('stored "' + v + '"');
    console.log('       ' + v);
  });

  await t('closing the app right after saving does not lose the change', async () => {
    await typeInto('#set-phone', '(780) 222-3344');
    await pg.click('[data-action="save-settings"]');
    await pg.waitForTimeout(250);                 // well inside the 2.5s debounce
    const owed = await pg.evaluate(() => {
      const c = JSON.parse(localStorage.getItem('pcp.cloud.v1') || '{}');
      return c.unsent === true;
    });
    if (!owed) throw new Error('the unsent change was not written down');
    await pg.reload(); await pg.waitForTimeout(1800);
    const v = await pg.evaluate(() => Store.data.settings.phone);
    if (v !== '(780) 222-3344') throw new Error('lost it — reopened as "' + v + '"');
    const srv = await (await fetch('http://127.0.0.1:54321/__state')).json();
    const up = srv.shops['user-1'].data.settings.phone;
    if (up !== '(780) 222-3344') throw new Error('never reached the server: "' + up + '"');
    console.log('       kept locally and pushed up on next open');
  });

  await t('a number typed through interruptions still saves', async () => {
    await typeInto('#set-phone', '7805550147');
    await pg.evaluate(() => window.dispatchEvent(new Event('online')));
    await pg.waitForTimeout(400);
    await pg.evaluate(() => Cloud.syncNow({quiet:true}));
    await pg.waitForTimeout(400);
    await pg.click('[data-action="save-settings"]'); await pg.waitForTimeout(600);
    const v = await pg.evaluate(() => Store.data.settings.phone);
    if (v !== '7805550147') throw new Error('stored "' + v + '"');
    console.log('       survived two interruptions and saved');
  });

  await t('the view catches up once the field is let go of', async () => {
    await typeInto('#set-phone', '123');
    await pg.evaluate(() => Cloud.set('error', 'no connection — saved on this device'));
    await pg.waitForTimeout(300);
    const held = await pg.evaluate(() => ({ owed: renderOwed,
      card: (document.querySelector('.cloud-state')||{}).textContent || '' }));
    if (!held.owed) throw new Error('render was not deferred');
    await pg.evaluate(() => document.querySelector('#set-phone').blur());
    await pg.waitForTimeout(400);
    const after = await pg.evaluate(() => ({ owed: renderOwed,
      card: (document.querySelector('.cloud-state')||{}).textContent.replace(/\s+/g,' ').trim() }));
    if (after.owed) throw new Error('still owed after blur');
    if (!/no connection/i.test(after.card)) throw new Error('card did not catch up: ' + after.card);
    console.log('       deferred while typing, then "' + after.card.slice(0,38) + '"');
  });

  await t('other settings fields are protected too', async () => {
    await typeInto('#set-email', 'admin@poseidonplumbing.ca');
    await pg.evaluate(() => Cloud.syncNow({quiet:true}));
    await pg.waitForTimeout(700);
    const s = await state('#set-email');
    if (s.v !== 'admin@poseidonplumbing.ca') throw new Error('became "' + s.v + '"');
    console.log('       email field held its value too');
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
