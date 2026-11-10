/* An edit made while a sync is on the wire is not lost.

   Nov 9, entering a receipt into a job's Materials: a cost that had just
   been entered was gone after the next save or reload — twice on one job,
   twice more on the next. What held was waiting for "Synced" before
   touching anything else.

   The race: a push sends the shop as it is when the request goes out, then
   marks the device "nothing unsent". A cost typed while that request was
   travelling was never in it, but was marked sent anyway — so the next sync
   pulled the server's copy, without it, over the top. A pull could do the
   same to an edit typed while it was fetching.

   These tests hold the request open, make the edit in the gap, then let it
   go, which is the timing a phone on a weak signal produces by itself.  */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP='http://127.0.0.1:54321/index.html', URL_='http://127.0.0.1:54321', KEY='sb_publishable_test';
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  await fetch(URL_+'/__reset');
  const pg = await b.newPage({ viewport:{width:1280,height:1000} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text())});
  await pg.goto(APP); await pg.waitForTimeout(400);
  await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'T'}; Cloud.saveCfg();
    return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY]);
  await pg.waitForTimeout(900);

  /* A job with two receipt lines, synced, so the server and the phone agree. */
  const jid = await pg.evaluate(async () => {
    clearTimeout(Cloud.pushTimer);
    const j = Store.data.jobs[0];
    j.materials = [
      { id:'mA', text:'Chip brush',  qty:1, cost:null, got:true, from:'job', addedAt:1 },
      { id:'mB', text:'Incepa tile', qty:1, cost:null, got:true, from:'job', addedAt:2 }
    ];
    Store.save(); clearTimeout(Cloud.pushTimer); await Cloud.syncNow();
    return j.id;
  });

  /* Hold the next request matching `re` until release() is called. */
  await pg.evaluate(() => {
    window.__hold = null;
    const real = Cloud.call.bind(Cloud);
    Cloud.call = async function(path, opts){
      const h = window.__hold;
      if (h && h.re.test(((opts && opts.method) || 'GET') + ' ' + path)){
        window.__hold = null;
        // A real request carries the shop as it was when it left, not as
        // it is when it lands. Freeze the body now, as the network would.
        if (opts && opts.body && typeof opts.body === 'object')
          opts = Object.assign({}, opts, { body: JSON.parse(JSON.stringify(opts.body)) });
        h.reached = true;
        await new Promise(r => { h.release = r; });
      }
      return real(path, opts);
    };
  });
  const holdNext = re => pg.evaluate(src => { window.__hold = { re: new RegExp(src) }; window.__lastHold = window.__hold; }, re);
  const waitHeld = () => pg.waitForFunction(() => window.__lastHold && window.__lastHold.reached, null, { timeout: 5000 });
  const release  = () => pg.evaluate(() => window.__lastHold.release());
  const cost = id => pg.evaluate(([j,m]) => (Store.job(j).materials.find(x => x.id === m) || {}).cost, [jid, id]);
  const serverCost = id => pg.evaluate(async ([j,m]) => {
    const row = await Cloud.fetchRow();
    const job = row.data.jobs.find(x => x.id === j);
    return (job.materials.find(x => x.id === m) || {}).cost;
  }, [jid, id]);
  const setCost = (id, v) => pg.evaluate(([j,m,v]) => { Store.setMaterial('job', j, m, { cost: v }); clearTimeout(Cloud.pushTimer); }, [jid, id, v]);

  console.log('--- a cost typed while a save is on its way ---');
  await t('a cost entered while the previous save is still sending survives the next sync', async () => {
    await setCost('mA', 4.97);
    await holdNext('^PATCH /rest/v1/shops');
    const first = pg.evaluate(() => Cloud.syncNow({ quiet:true }));
    await waitHeld();
    await setCost('mB', 86.32);            // typed while the first save is in the air
    await release(); await first;
    // what the 2.5-second timer would do next
    await pg.evaluate(() => Cloud.syncNow({ quiet:true }));
    const here = await cost('mB');
    if (here !== 86.32) throw new Error('on the phone the tile now costs ' + here + ' — it was 86.32');
    if (await cost('mA') !== 4.97) throw new Error('the first cost went too');
  });
  await t('and it reaches the server, so a reload or another device keeps it', async () => {
    const s = await serverCost('mB');
    if (s !== 86.32) throw new Error('server has ' + s);
    if (await serverCost('mA') !== 4.97) throw new Error('server lost the first cost');
    const st = await pg.evaluate(() => ({ dirty: Cloud.dirty, state: Cloud.state }));
    if (st.dirty || st.state !== 'synced') throw new Error(JSON.stringify(st));
  });

  console.log('--- a cost typed while it is reading from the server ---');
  await t('a cost entered while a read is on its way is not covered by the server copy', async () => {
    await holdNext('^GET /rest/v1/shops');
    const pull = pg.evaluate(() => Cloud.syncNow({ quiet:true }));
    await waitHeld();
    await setCost('mA', 5.25);
    await release(); await pull;
    if (await cost('mA') !== 5.25) throw new Error('the read laid the old cost over it: ' + await cost('mA'));
    await pg.evaluate(() => Cloud.syncNow({ quiet:true }));
    if (await serverCost('mA') !== 5.25) throw new Error('never reached the server');
  });

  console.log('--- two syncs at once ---');
  await t('a second sync asked for mid-sync waits its turn instead of colliding', async () => {
    await setCost('mB', 90.10);
    await holdNext('^PATCH /rest/v1/shops');
    const a = pg.evaluate(() => Cloud.syncNow({ quiet:true }));
    await waitHeld();
    await setCost('mA', 6.00);
    const bb = pg.evaluate(() => Cloud.syncNow({ quiet:true }));   // the timer firing mid-push
    await release(); await a; await bb;
    const st = await pg.evaluate(() => ({ state: Cloud.state, dialog: /changed somewhere else/i.test((document.querySelector('#modal-root')||{}).textContent||'') }));
    if (st.dialog || st.state === 'conflict') throw new Error('it asked him to choose between this phone and itself');
    if (await serverCost('mA') !== 6.00 || await serverCost('mB') !== 90.10) throw new Error('server: ' + await serverCost('mA') + ' / ' + await serverCost('mB'));
  });

  await b.close();
  const hard = errs.filter(e=>e.includes('CONSOLE')||e.includes('PAGEERROR'));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
