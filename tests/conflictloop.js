/* "This shop changed somewhere else" kept coming back however he answered it. */
const { chromium } = require(process.env.PW || 'playwright-core');
const APP='http://127.0.0.1:54321/index.html', URL_='http://127.0.0.1:54321', KEY='sb_publishable_test';
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  await fetch(URL_+'/__reset');
  const pg = await b.newPage({ viewport:{width:430,height:900} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text())});
  await pg.goto(APP); await pg.waitForTimeout(400);
  await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'Phone'}; Cloud.saveCfg();
    return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY]);
  await pg.waitForTimeout(1000);

  const dialogUp = () => pg.evaluate(() =>
    /changed somewhere else/i.test(document.querySelector('#modal-root') ?
      document.querySelector('#modal-root').textContent : ''));
  // the other device saves, and so does this one — a real conflict
  const collide = () => pg.evaluate(async () => {
    await fetch(Cloud.base() + '/__poison').catch(()=>{});
    Store.data.settings.notes = "edited here " + Date.now();
    Cloud.dirty = true;
    await Cloud.syncNow();
  });

  await t('a genuine collision raises the question once', async () => {
    await collide(); await pg.waitForTimeout(600);
    if (!await dialogUp()) throw new Error('it never asked');
    const n = await pg.evaluate(() => Cloud.conflictOpen);
    if (!n) throw new Error('it did not record that the question is open');
  });

  await t('while it is open nothing schedules another push behind it', async () => {
    const scheduled = await pg.evaluate(() => {
      Cloud.pushTimer = null;
      Store.data.settings.notes = "typing while the dialog is up";
      Cloud.markDirty();
      return !!Cloud.pushTimer;
    });
    if (scheduled) throw new Error('queued a push that could only conflict again');
  });

  await t('and the sibling pulls keep their hands off the copy he is choosing', async () => {
    const touched = await pg.evaluate(async () => {
      let called = 0;
      const real = Cloud.pullSignLinks;
      Cloud.pullSignLinks = async function(){ called++; return real.apply(this, arguments); };
      Cloud.dirty = true;
      try { await Cloud.syncNow(); } catch(e){}
      await new Promise(r => setTimeout(r, 400));
      Cloud.pullSignLinks = real;
      return called;
    });
    if (touched) throw new Error('pullSignLinks ran ' + touched + 'x during an open conflict');
  });

  await t('asking again while it is already up does not stack a second dialog', async () => {
    await pg.evaluate(async () => { Cloud.dirty = true; try { await Cloud.syncNow(); } catch(e){} });
    await pg.waitForTimeout(400);
    const n = await pg.evaluate(() => document.querySelectorAll('[data-conflict]').length);
    if (n !== 2) throw new Error('expected one dialog with two buttons, found ' + n + ' buttons');
  });

  await t('"Keep this device" settles it — and it stays settled', async () => {
    await pg.click('[data-conflict="mine"]'); await pg.waitForTimeout(1500);
    if (await dialogUp()) throw new Error('still asking straight after answering');
    if (await pg.evaluate(() => Cloud.conflictOpen)) throw new Error('flag never cleared');
    // let every held timer fire
    await pg.waitForTimeout(3500);
    if (await dialogUp()) throw new Error('it came back on its own a few seconds later');
    const s = await pg.evaluate(() => ({ dirty: Cloud.dirty, state: Cloud.state }));
    if (s.dirty) throw new Error('still carrying unsent work: ' + JSON.stringify(s));
  });

  await t('the sibling pulls start running again once it is settled', async () => {
    const ran = await pg.evaluate(async () => {
      let called = 0;
      const real = Cloud.pullSignLinks;
      Cloud.pullSignLinks = async function(){ called++; return real.apply(this, arguments); };
      await Cloud.syncNow();
      await new Promise(r => setTimeout(r, 300));
      Cloud.pullSignLinks = real;
      return called;
    });
    if (!ran) throw new Error('they never came back');
  });

  await t('a repeat collision says plainly what is causing it', async () => {
    await collide(); await pg.waitForTimeout(700);
    const tx = await pg.evaluate(() => document.querySelector('#modal-root').textContent.replace(/\s+/g,' '));
    if (!/keeps happening/i.test(tx)) throw new Error('no repeat warning :: ' + tx.slice(0,220));
    if (!/home screen|another tab/i.test(tx)) throw new Error('does not name the likely cause');
    await pg.click('[data-conflict="mine"]'); await pg.waitForTimeout(1200);
  });

  await t('when both copies hold the same work it says either button is safe', async () => {
    await collide(); await pg.waitForTimeout(700);
    const tx = await pg.evaluate(() => document.querySelector('#modal-root').textContent.replace(/\s+/g,' '));
    if (!/same amount of work|Either button is safe/i.test(tx))
      throw new Error('no reassurance when the counts match :: ' + tx.slice(0,220));
    await pg.click('[data-conflict="mine"]'); await pg.waitForTimeout(1200);
  });

  await t('"Take the other one" settles it just as firmly', async () => {
    await collide(); await pg.waitForTimeout(700);
    if (!await dialogUp()) throw new Error('no dialog to answer');
    await pg.click('[data-conflict="theirs"]'); await pg.waitForTimeout(1500);
    if (await dialogUp()) throw new Error('still asking');
    await pg.waitForTimeout(3500);
    if (await dialogUp()) throw new Error('it came back on its own');
    if (await pg.evaluate(() => Cloud.conflictOpen)) throw new Error('flag never cleared');
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
