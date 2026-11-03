const { chromium } = require(process.env.PW || 'playwright-core');
const URL_='http://127.0.0.1:54321', KEY='sb_publishable_test', errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1400,height:1000} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await fetch(URL_+'/__reset');
  await pg.goto(URL_+'/index.html'); await pg.waitForTimeout(450);

  const connect = u => pg.evaluate(([x,k]) => {
    Cloud.cfg = { url:x, key:k, email:'', deviceId:'Test-a' }; Cloud.saveCfg();
    Cloud.state='signed-out'; go('data');
  }, [u, KEY]);

  await t('a wrong password leaves what you typed in the boxes', async () => {
    await connect(URL_); await pg.waitForTimeout(400);
    await pg.fill('#cl-email','allen@example.com');
    await pg.fill('#cl-pass','WRONG');
    await pg.click('[data-action="cloud-signin"]');
    await pg.waitForTimeout(900);
    const st = await pg.evaluate(() => ({
      email: (document.querySelector('#cl-email')||{}).value,
      pass:  (document.querySelector('#cl-pass') ||{}).value,
      err:   (document.querySelector('#cl-err')  ||{}).textContent,
      btn:   (document.querySelector('[data-action="cloud-signin"]')||{}).textContent
    }));
    if (st.email !== 'allen@example.com') throw new Error('email wiped: ' + JSON.stringify(st));
    if (st.pass !== 'WRONG') throw new Error('password wiped: ' + JSON.stringify(st));
    if (!/not accepted/i.test(st.err||'')) throw new Error('error says: '+st.err);
    if (!/Auto Confirm/i.test(st.err||'')) throw new Error('no hint about Auto Confirm');
    if (!/Sign in/i.test(st.btn||'')) throw new Error('button stuck on: '+st.btn);
    console.log('       both fields kept, button reset, "' + (st.err||'').slice(0,46) + '…"');
  });

  await t('fixing just the password and retrying works', async () => {
    await pg.fill('#cl-pass','correct-horse');
    await pg.click('[data-action="cloud-signin"]');
    await pg.waitForTimeout(1200);
    const s = await pg.evaluate(() => Cloud.state);
    if (s !== 'synced') throw new Error('state '+s+' / '+await pg.evaluate(()=>Cloud.detail));
    console.log('       no retyping needed');
  });

  await t('an unreachable project reports the network, not your password', async () => {
    await pg.evaluate(() => { Cloud.signOut(); });
    await connect('https://not-a-real-project-xyz.supabase.co'); await pg.waitForTimeout(400);
    await pg.context().setOffline(true);
    await pg.fill('#cl-email','allen@example.com');
    await pg.fill('#cl-pass','correct-horse');
    await pg.click('[data-action="cloud-signin"]');
    await pg.waitForTimeout(1200);
    const st = await pg.evaluate(() => ({
      err:(document.querySelector('#cl-err')||{}).textContent,
      email:(document.querySelector('#cl-email')||{}).value }));
    if (!/reach the project/i.test(st.err||'')) throw new Error('says: '+st.err);
    if (st.email !== 'allen@example.com') throw new Error('email wiped on network error');
    await pg.context().setOffline(false);
    console.log('       "' + (st.err||'').slice(0,52) + '…"');
  });

  await t('inside a frame it names the sandbox instead of blaming the wifi', async () => {
    const outer = await b.newPage({ viewport:{width:1400,height:1000} });
    await outer.setContent('<iframe src="'+URL_+'/index.html" style="width:1300px;height:900px;border:0"></iframe>');
    await outer.waitForTimeout(900);
    const f = outer.frames().find(x => x.url().includes('index.html'));
    await f.evaluate(([x,k]) => {
      Cloud.cfg = { url:'https://blocked-host-xyz.supabase.co', key:k, email:'', deviceId:'F' };
      Cloud.saveCfg(); Cloud.state='signed-out'; go('data');
    }, [URL_, KEY]);
    await outer.waitForTimeout(400);
    await outer.context().setOffline(true);
    await f.fill('#cl-email','allen@example.com');
    await f.fill('#cl-pass','x');
    await f.click('[data-action="cloud-signin"]');
    await outer.waitForTimeout(1200);
    const err = await f.evaluate(() => (document.querySelector('#cl-err')||{}).textContent);
    if (!/sandbox/i.test(err||'')) throw new Error('says: '+err);
    if (!/own web address/i.test(err||'')) throw new Error('no instruction to move: '+err);
    await outer.context().setOffline(false);
    console.log('       "' + (err||'').slice(0,60) + '…"');
    await outer.close();
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
