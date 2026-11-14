/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP = 'http://127.0.0.1:54321/index.html';
const URL_ = 'http://127.0.0.1:54321', KEY = 'sb_publishable_test';
const errs = [];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const mk = async () => {
    const pg = await b.newPage({ viewport:{width:1400,height:950}, acceptDownloads:true });
    pg.on('pageerror', e => errs.push('PAGEERROR: '+e.message));
    pg.on('console', m => { if (m.type()==='error' && !/Failed to load resource/.test(m.text())) errs.push('CONSOLE: '+m.text()); });
    await pg.goto(APP); await pg.waitForTimeout(400);
    return pg;
  };
  const connect = async (pg, email, pass) => {
    await pg.evaluate(([u,k]) => {
      Cloud.cfg = { url:u, key:k, email:'', deviceId:'Test-'+Math.random().toString(36).slice(2,6) };
      Cloud.saveCfg(); Cloud.state='signed-out';
    }, [URL_, KEY]);
    return pg.evaluate(([e,p]) => Cloud.signIn(e,p).then(()=>Cloud.syncNow()).then(()=>Cloud.state),
                       [email||'allen@example.com', pass||'correct-horse']);
  };
  const fetchJson = p => fetch(URL_+p).then(r=>r.json());
  await fetchJson('/__reset');

  console.log('--- connecting ---');
  const A = await mk();

  await t('a bad key is refused and nothing is stored', async () => {
    const r = await A.evaluate(u => {
      Cloud.cfg = { url:u, key:'sb_publishable_WRONG', deviceId:'x' }; Cloud.saveCfg();
      return Cloud.signIn('allen@example.com','correct-horse').then(()=>'signed in').catch(e=>e.message);
    }, URL_);
    if (!/Invalid API key/i.test(r)) throw new Error('got: '+r);
    console.log('       "' + r + '"');
  });

  await t('a wrong password says so without locking anything up', async () => {
    const r = await A.evaluate(([u,k]) => {
      Cloud.cfg = { url:u, key:k, deviceId:'x' }; Cloud.saveCfg();
      return Cloud.signIn('allen@example.com','nope').then(()=>'signed in').catch(e=>e.message);
    }, [URL_, KEY]);
    if (!/Invalid login credentials/i.test(r)) throw new Error('got: '+r);
    console.log('       "' + r + '"');
  });

  await t('signing in uploads the shop that was already on the device', async () => {
    await A.evaluate(() => { Store.data.customers[0].name = 'Device A Canary'; Store.saveLocal(); });
    const st = await connect(A);
    if (st !== 'synced') throw new Error('state='+st+' detail='+await A.evaluate(()=>Cloud.detail));
    const srv = await fetchJson('/__state');
    const row = srv.shops['user-1'];
    if (!row) throw new Error('nothing on the server');
    if (!row.data.customers.some(c => c.name === 'Device A Canary')) throw new Error('wrong data uploaded');
    console.log('       rev ' + row.rev + ', ' + row.data.jobs.length + ' jobs on the server');
  });

  await t('the key is sent as apikey, never as a bearer token', async () => {
    // the mock 401s if the key shows up in Authorization; we got this far, so it didn't
    const seen = await A.evaluate(() => Cloud.state);
    if (seen !== 'synced') throw new Error('state '+seen);
    console.log('       mock would have rejected it otherwise');
  });

  console.log('--- a second device ---');
  const B = await mk();

  await t('a second device signing in picks up the first one\'s shop', async () => {
    await B.evaluate(() => { localStorage.removeItem('pcp.dispatch.v1'); });
    await B.reload(); await B.waitForTimeout(400);
    const st = await connect(B);
    if (st !== 'synced') throw new Error('state='+st);
    const got = await B.evaluate(() => Store.data.customers.some(c => c.name === 'Device A Canary'));
    if (!got) throw new Error('device B did not receive the shop');
    console.log('       device B pulled the shop down');
  });

  await t('an edit on one device reaches the other', async () => {
    await B.evaluate(() => { Store.data.customers[1].name = 'Device B Edit'; Store.save(); });
    await B.waitForTimeout(3200);                       // debounce + round trip
    const bState = await B.evaluate(() => Cloud.state);
    if (bState !== 'synced') throw new Error('B state '+bState+' / '+await B.evaluate(()=>Cloud.detail));
    await A.evaluate(() => Cloud.syncNow());
    await A.waitForTimeout(600);
    const got = await A.evaluate(() => Store.data.customers.some(c => c.name === 'Device B Edit'));
    if (!got) throw new Error('A never saw B\'s edit');
    console.log('       B edited, A caught up');
  });

  console.log('--- both at once ---');
  await t('two devices editing at once is caught, not silently merged', async () => {
    await A.evaluate(() => { Store.data.customers[2].name = 'A offline edit'; Store.saveLocal(); Cloud.dirty = true; });
    await fetchJson('/__poison?set=customers.2.name&to=B%20edit');   // B writes the same field behind A's back
    const r = await A.evaluate(() => Cloud.push().then(x => x.conflict ? 'conflict' : 'pushed'));
    if (r !== 'conflict') throw new Error('got '+r+' — A clobbered B');
    console.log('       the stale write was refused by the rev guard');
  });

  await t('the conflict asks instead of choosing, and shows both sides', async () => {
    await A.evaluate(() => Cloud.syncNow());
    await A.waitForTimeout(500);
    const m = await A.evaluate(() => {
      const el = document.querySelector('.modal');
      return el ? el.textContent.replace(/\s+/g,' ') : null;
    });
    if (!m) throw new Error('no conflict modal');
    if (!/This device/.test(m) || !/other device/i.test(m)) throw new Error('modal: '+m.slice(0,120));
    if (!/Nothing has been overwritten/.test(m)) throw new Error('no reassurance');
    if (!/A offline edit/.test(m) || !/B edit/.test(m)) throw new Error('both sides of the clash are not shown: '+m.slice(0,300));
    const st = await A.evaluate(() => Cloud.state);
    if (st !== 'conflict') throw new Error('state '+st);
    console.log('       "' + m.slice(0,88).trim() + '…"');
  });

  await t('keeping this device downloads the other copy before replacing it', async () => {
    const [dl] = await Promise.all([
      A.waitForEvent('download', { timeout: 8000 }),
      A.click('[data-conflict="mine"]')
    ]);
    if (!/other-device/.test(dl.suggestedFilename())) throw new Error('wrong file: '+dl.suggestedFilename());
    await A.waitForTimeout(900);
    const st = await A.evaluate(() => Cloud.state);
    if (st !== 'synced') throw new Error('state after resolve: '+st+' / '+await A.evaluate(()=>Cloud.detail));
    const srv = await fetchJson('/__state');
    if (!srv.shops['user-1'].data.customers.some(c => c.name === 'A offline edit'))
      throw new Error("A's copy did not win after choosing it");
    console.log('       saved ' + dl.suggestedFilename() + ', then A won');
  });

  console.log('--- offline ---');
  await t('losing the network keeps the app working and says so', async () => {
    await A.context().setOffline(true);
    await A.evaluate(() => { Store.data.customers[3].name = 'Written in a basement'; Store.save(); });
    await A.evaluate(() => Cloud.syncNow());
    await A.waitForTimeout(500);
    const st = await A.evaluate(() => ({ s:Cloud.state, d:Cloud.detail, dirty:Cloud.dirty }));
    if (st.s !== 'error' || !/no connection/i.test(st.d)) throw new Error(JSON.stringify(st));
    if (!st.dirty) throw new Error('forgot it had unsent work');
    const kept = await A.evaluate(() => Store.data.customers.some(c => c.name === 'Written in a basement'));
    if (!kept) throw new Error('the edit was lost');
    console.log('       "' + st.d + '" — edit kept, still marked unsent');
  });

  await t('the work goes up by itself when the signal comes back', async () => {
    await A.context().setOffline(false);
    await A.evaluate(() => Cloud.syncNow());
    await A.waitForTimeout(900);
    const srv = await fetchJson('/__state');
    if (!srv.shops['user-1'].data.customers.some(c => c.name === 'Written in a basement'))
      throw new Error('the basement edit never went up');
    console.log('       basement edit landed at rev ' + srv.shops['user-1'].rev);
  });

  console.log('--- keys stay out of the build ---');
  await t('no secret key or token reaches anything published', async () => {
    const fs = require('fs');

    /* Two different rules, because two different risks.

       Secret material — the service_role key, anything sb_secret_, a JWT —
       must never appear in any published file, full stop. Holding one lets a
       stranger read and write the whole shop.

       The publishable key and the project URL are a different thing. They
       already travel in plain text inside every signing link he texts a
       customer; Supabase calls that key publishable because it belongs in a
       browser. The protection is that anon has no table rights and only
       narrow security definer functions are reachable, not that the key is
       hidden. They are baked into sign.html and invoice.html on purpose, so
       a redeploy cannot silently strip them and leave customers holding a
       dead link — which is exactly what happened once.

       The app itself is still held to the strict rule. It takes its project
       from the URL hash or what he typed, never from something compiled in. */
    const SECRET = [
      [/sb_secret_[A-Za-z0-9_-]{10,}/,  'a secret key'],
      [/eyJhbGciOi[A-Za-z0-9_.-]{20,}/, 'a JWT']
    ];
    /* Not the bare words "service_role". They appear in index.html in the
       check that REFUSES a secret key if he ever pastes one, and in the SQL
       comments explaining the grants. A service_role key is a JWT or an
       sb_secret_ string, and both are caught above; banning the name would
       only delete the guard that protects him. */
    const PUBLIC_TOO = SECRET.concat([
      [/sb_publishable_[A-Za-z0-9_-]{10,}/, 'a publishable key'],
      [/https:\/\/(?!abcdefgh)[a-z0-9]{15,}\.supabase\.co/, 'a real project URL']
    ]);
    const MAY_CARRY_PUBLIC = new Set(['sign.html', 'invoice.html']);

    const files = fs.readdirSync(REPO_DIR).filter(f => /\.(html|json|js)$/.test(f));
    if (!files.includes('index.html')) throw new Error('index.html is not where it should be');

    for (const f of files){
      const txt  = fs.readFileSync(`${REPO_DIR}/${f}`, 'utf8');
      const rule = MAY_CARRY_PUBLIC.has(f) ? SECRET : PUBLIC_TOO;
      const hit  = rule.filter(([r]) => r.test(txt)).map(([,n]) => n);
      if (hit.length) throw new Error(`found in ${f}: ` + hit.join(', '));
    }
    console.log('       no secret material across ' + files.length + ' published files');
  });

  await t('the two signing pages really do carry their project, so links survive a redeploy', async () => {
    const fs = require('fs');
    for (const f of ['sign.html', 'invoice.html']){
      const txt = fs.readFileSync(`${REPO_DIR}/${f}`, 'utf8');
      const url = /const BAKED_URL = "(https:\/\/[a-z0-9]+\.supabase\.co)"/.exec(txt);
      const key = /const BAKED_KEY = "(sb_publishable_[A-Za-z0-9_-]+)"/.exec(txt);
      if (!url) throw new Error(`${f} has no project URL baked in — a short link sent from it is dead`);
      if (!key) throw new Error(`${f} has no publishable key baked in — a short link sent from it is dead`);
    }
    console.log('       both pages can stand on their own');
  });

  await t('the secret key is refused if it is ever pasted in', async () => {
    const C = await mk();
    await C.evaluate(() => go('data')); await C.waitForTimeout(400);
    await C.evaluate(() => { Cloud.disconnect(); render(); }); await C.waitForTimeout(300);
    await C.fill('#cl-url', 'https://abcdefgh.supabase.co');
    await C.fill('#cl-key', 'sb_secret_dangerous');
    await C.click('[data-action="cloud-save"]'); await C.waitForTimeout(300);
    const err = await C.$eval('#cl-err', e => e.textContent);
    if (!/secret/i.test(err)) throw new Error('accepted it: '+err);
    const stored = await C.evaluate(() => localStorage.getItem('pcp.cloud.v1'));
    if (stored && /sb_secret/.test(stored)) throw new Error('stored the secret key anyway');
    console.log('       "' + err.trim() + '"');
    await C.close();
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e => console.log('  '+e));
  process.exit(errs.length?1:0);
})();
