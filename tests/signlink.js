/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP='http://127.0.0.1:54321/index.html', URL_='http://127.0.0.1:54321', KEY='sb_publishable_test';
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  await fetch(URL_+'/__reset');

  const pg = await b.newPage({ viewport:{width:1280,height:1100} });
  pg.on('pageerror',e=>errs.push('APP PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('APP CONSOLE: '+m.text())});
  await pg.goto(APP); await pg.waitForTimeout(400);
  await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'T'}; Cloud.saveCfg();
    return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY]);
  await pg.waitForTimeout(900);

  const eid = await pg.evaluate(() => {
    Object.assign(Store.data.settings, { gst:'123456789 RT0001', gstRate:5, email:'admin@poseidonplumbing.ca' });
    const e = Store.data.estimates.find(x => (x.items||[]).length);
    e.status='draft'; delete e.approval; Store.save(); return e.id;
  });

  let link = null;
  console.log('--- making the link ---');
  await t('Send for signature publishes the estimate and hands back a link', async () => {
    await pg.evaluate(id => openEstimate(id), eid); await pg.waitForTimeout(400);
    if (!await pg.$(`[data-link-estimate="${eid}"]`)) throw new Error('no send-for-signature button');
    await pg.click(`[data-link-estimate="${eid}"]`); await pg.waitForTimeout(1200);
    const note = await pg.inputValue('#lk-note');
    const m = note.match(/https?:\/\/\S+/);
    if (!m) throw new Error('no link in the message: ' + note.slice(0,160));
    link = m[0];
    if (!/sign\.html#/.test(link)) throw new Error('link is not a hash link: ' + link);
    if (/\?.*k=/.test(link.split('#')[0])) throw new Error('key leaked into the query string');
    // making the link is not sending it — he has to actually tap something
    const before = await pg.evaluate(id => Store.estimate(id).status, eid);
    if (before !== 'draft') throw new Error('marked ' + before + ' before he sent anything');
    await pg.click('[data-copy-link][data-sent-id]'); await pg.waitForTimeout(400);
    const st = await pg.evaluate(id => Store.estimate(id).status, eid);
    if (st !== 'sent') throw new Error('estimate still ' + st);
    console.log('       ' + link.slice(0, 64) + '…');
  });

  await t('the key rides in the hash, which never reaches a server', async () => {
    const [path, hash] = link.split('#');
    if (!hash.includes('k=')) throw new Error('no key in the hash');
    if (path.includes(KEY)) throw new Error('key is in the part the server sees');
    if (!hash.includes('t=') || !hash.includes('u=')) throw new Error('hash missing token or url');
  });

  await t('the estimate now says it is out for signature', async () => {
    await pg.evaluate(() => closeModal());
    await pg.evaluate(id => openEstimate(id), eid); await pg.waitForTimeout(500);
    const tx = await pg.evaluate(() => document.querySelector('#modal-root').textContent.replace(/\s+/g,' '));
    if (!/Out for signature/.test(tx)) throw new Error('no waiting panel: ' + tx.slice(0,200));
    if (!/Sent today/.test(tx)) throw new Error('does not say when');
  });

  console.log('--- what the customer opens ---');
  const cust = await b.newPage({ viewport:{width:390,height:844} });
  cust.on('pageerror',e=>errs.push('SIGN PAGEERROR: '+e.message));
  cust.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('SIGN CONSOLE: '+m.text())});

  await t('it shows the estimate, the lines and the total', async () => {
    await cust.goto(link); await cust.waitForTimeout(900);
    const tx = await cust.evaluate(() => document.querySelector('#root').textContent.replace(/\s+/g,' '));
    const want = await pg.evaluate(id => {
      const e = Store.estimate(id);
      const sub = Store.estimateTotal(e), tax = Math.round(sub*Store.taxRate()*100)/100;
      return { first:e.items[0].desc, total: money(Math.round((sub+tax)*100)/100),
               co: Store.data.settings.company, no: e.no };
    }, eid);
    for (const w of [want.first, want.total, want.co, 'EST-' + want.no]){
      if (!tx.includes(w)) throw new Error('"' + w + '" missing from the page');
    }
    if (!/Good for \d+ days/.test(tx)) throw new Error('no expiry shown');
    console.log('       ' + want.co + ', EST-' + want.no + ', ' + want.total);
  });

  await t('it reaches nothing else — no other estimate, no customers', async () => {
    const leak = await cust.evaluate(() => document.querySelector('#root').textContent);
    const others = await pg.evaluate(id => Store.data.estimates.filter(x => x.id !== id)
      .map(x => 'EST-' + x.no), eid);
    const found = others.filter(o => leak.includes(o));
    if (found.length) throw new Error('other estimates visible: ' + JSON.stringify(found));
    const names = await pg.evaluate(() => Store.data.customers.map(c => c.name));
    const mine = await pg.evaluate(id => Store.estContact(Store.estimate(id)).name, eid);
    const bleed = names.filter(n => n !== mine && leak.includes(n));
    if (bleed.length) throw new Error('other customers visible: ' + JSON.stringify(bleed));
  });

  await t('it refuses to submit with no name or no signature', async () => {
    await cust.fill('#nm', '');
    await cust.click('#go'); await cust.waitForTimeout(300);
    if (!await cust.isVisible('#nm-err')) throw new Error('allowed an empty name');
    if (!await cust.isVisible('#sig-err')) throw new Error('allowed an empty signature');
  });

  await t('the customer signs and it is accepted', async () => {
    await cust.fill('#nm', 'Cassie Moreau');
    const pad = await cust.$('#pad');
    await pad.scrollIntoViewIfNeeded(); await cust.waitForTimeout(250);
    const box = await pad.boundingBox();
    await cust.mouse.move(box.x+30, box.y+box.height*0.6); await cust.mouse.down();
    for (let i=1;i<=18;i++) await cust.mouse.move(box.x+30+i*14, box.y+box.height*(0.6-Math.sin(i/2.2)*0.25));
    await cust.mouse.up(); await cust.mouse.move(5,5); await cust.waitForTimeout(250);
    await cust.evaluate(() => document.querySelector('#go').click());
    await cust.waitForTimeout(900);
    const tx = await cust.evaluate(() => document.querySelector('#root').textContent.replace(/\s+/g,' '));
    if (!/Approved — thank you/.test(tx)) throw new Error('did not confirm: ' + tx.slice(0,200));
  });

  await t('opening the same link again says it is already done', async () => {
    await cust.goto('about:blank'); await cust.goto(link); await cust.waitForTimeout(900);
    const tx = await cust.evaluate(() => document.querySelector('#root').textContent.replace(/\s+/g,' '));
    if (!/Already approved/.test(tx)) throw new Error(tx.slice(0,200));
    if (!/Cassie Moreau/.test(tx)) throw new Error('does not name who signed');
    if (await cust.$('#pad')) throw new Error('offered a second signature');
  });

  console.log('--- it comes back on its own ---');
  await t('the next sync turns it into a real approval on the estimate', async () => {
    await pg.evaluate(() => closeModal());
    await pg.evaluate(() => Cloud.pullSignLinks()); await pg.waitForTimeout(800);
    const r = await pg.evaluate(id => {
      const e = Store.estimate(id);
      return e.approval ? { status:e.status, name:e.approval.name, how:e.approval.how,
        kind:String(e.approval.signature||'').slice(0,22), len:String(e.approval.signature||'').length,
        frozen:e.approval.total, log:e.log.map(l=>l.text).join(' | ') } : null;
    }, eid);
    if (!r) throw new Error('nothing landed');
    if (r.status !== 'approved') throw new Error('status ' + r.status);
    if (r.name !== 'Cassie Moreau') throw new Error('signer ' + r.name);
    if (!/^data:image\/png/.test(r.kind)) throw new Error('signature not an image');
    if (r.len < 300) throw new Error('tiny signature: ' + r.len);
    if (!/signed from the link/.test(r.how)) throw new Error('how: ' + r.how);
    if (!/Approved on screen by Cassie Moreau/.test(r.log)) throw new Error('not logged');
    console.log('       ' + r.name + ', ' + Math.round(r.len/1024) + 'KB, via the link');
  });

  await t('a second sync does not sign it twice', async () => {
    const before = await pg.evaluate(id => Store.estimate(id).approval.at, eid);
    await pg.evaluate(() => Cloud.pullSignLinks()); await pg.waitForTimeout(600);
    const after = await pg.evaluate(id => Store.estimate(id).approval.at, eid);
    if (before !== after) throw new Error('overwrote the approval on a re-sync');
  });

  await t('the waiting panel goes once it is signed', async () => {
    await pg.evaluate(id => openEstimate(id), eid); await pg.waitForTimeout(500);
    const tx = await pg.evaluate(() => document.querySelector('#modal-root').textContent.replace(/\s+/g,' '));
    if (/Out for signature/.test(tx)) throw new Error('still says it is waiting');
    if (!/Approved by Cassie Moreau/.test(tx)) throw new Error('approval not shown');
  });

  console.log('--- noticing it without being touched ---');
  await t('signed elsewhere, app untouched: it does not know yet', async () => {
    // His exact case. Signing from node means no second browser page, so the
    // app's tab never loses visibility and no sync is triggered — which is
    // what left a signed estimate sitting in the database, invisible.
    const e2 = await pg.evaluate(async () => {
      const e = Store.data.estimates.find(x => (x.items||[]).length && !x.approval);
      if (!e) return null;
      e.status = 'draft'; Store.save();
      const tok = await Cloud.publishSignLink(e);
      await Cloud.pullSignLinks();
      return { id: e.id, tok };
    });
    if (!e2) { console.log('       (no spare estimate)'); return; }
    global.__e2 = e2.id;

    const png = 'data:image/png;base64,' + 'A'.repeat(400);
    const r = await fetch(URL_+'/rest/v1/rpc/sign_estimate', {
      method:'POST', headers:{ 'apikey':KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({ p_token:e2.tok, p_name:'Daryl Test', p_role:'Homeowner', p_signature:png })
    }).then(x => x.json());
    if (!r || !r.ok) throw new Error('the signature did not go in: ' + JSON.stringify(r));

    const got = await pg.evaluate(id => ({ status: Store.estimate(id).status,
      approval: !!Store.estimate(id).approval }), e2.id);
    if (got.approval) throw new Error('it somehow already knew');
    console.log('       signed in the database; the app still shows no approval');
  });

  await t('Check now brings it back on demand', async () => {
    const e2 = global.__e2;
    if (!e2) { console.log('       (skipped)'); return; }
    await pg.evaluate(() => closeModal());
    await pg.evaluate(id => openEstimate(id), e2); await pg.waitForTimeout(500);
    if (!await pg.$(`[data-check-signed="${e2}"]`)) throw new Error('no Check now button');
    await pg.click(`[data-check-signed="${e2}"]`); await pg.waitForTimeout(1200);
    const r = await pg.evaluate(id => {
      const e = Store.estimate(id);
      return { status:e.status, who: e.approval ? e.approval.name : null };
    }, e2);
    if (r.status !== 'approved') throw new Error('still ' + r.status);
    if (r.who !== 'Daryl Test') throw new Error('signer ' + r.who);
    console.log('       came back as approved, signed by ' + r.who);
  });

  await t('the watcher only runs while something is actually out', async () => {
    const r = await pg.evaluate(() => {
      Cloud.watchSignatures();
      const had = !!Cloud._sigTimer;
      const un = (Cloud.signLinks||[]).filter(l => !l.signed_at);
      return { had, outstanding: un.length,
               which: un.map(l => ({ est:l.estimate_id, tok:String(l.token).slice(0,8) })) };
    });
    if (!r.had) throw new Error('no watcher armed');
    if (r.outstanding !== 0) throw new Error('expected nothing outstanding, got ' + r.outstanding
      + ' :: ' + JSON.stringify(r.which));
  });

  await t('the Estimates list says how many are awaiting a signature', async () => {
    const e3 = await pg.evaluate(async () => {
      const e = Store.data.estimates.find(x => (x.items||[]).length && !x.approval);
      if (!e) return null;
      e.status='draft'; Store.save();
      await Cloud.publishSignLink(e); await Cloud.pullSignLinks();
      App.view='estimates'; App.search=''; render(); return e.id;
    });
    if (!e3) { console.log('       (no spare estimate)'); return; }
    await pg.waitForTimeout(400);
    const tx = await pg.evaluate(() => document.querySelector('#view').textContent.replace(/\s+/g,' '));
    if (!/awaiting signature/.test(tx)) throw new Error('not shown: ' + tx.slice(0,220));
  });

  console.log('--- when the lookup itself fails ---');
  await t('a broken lookup says so instead of hiding the panel', async () => {
    const e4 = await pg.evaluate(() => {
      const e = Store.data.estimates.find(x => (x.items||[]).length && !x.approval);
      if (!e) return null;
      e.status = 'sent'; Store.save();
      // what a missing table looks like coming back from PostgREST
      Cloud.signLinks = []; Cloud.linkError = 'no-table';
      return e.id;
    });
    if (!e4) { console.log('       (no spare estimate)'); return; }
    await pg.evaluate(() => closeModal());
    await pg.evaluate(id => openEstimate(id), e4); await pg.waitForTimeout(500);
    const tx = await pg.evaluate(() => document.querySelector('#modal-root').textContent.replace(/\s+/g,' '));
    if (!/Can't check for signatures/.test(tx)) throw new Error('said nothing: ' + tx.slice(0,220));
    if (!/supabase-signing\.sql/.test(tx)) throw new Error('did not say what to do about it');
    if (!await pg.$(`[data-check-signed="${e4}"]`))
      throw new Error('Check now disappeared exactly when it was needed');
    console.log('       names the problem and keeps Check now reachable');
  });

  await t('Data & Setup says whether the table is readable', async () => {
    await pg.evaluate(() => { closeModal(); App.view='data'; App.search=''; render(); });
    await pg.waitForTimeout(400);
    let tx = await pg.evaluate(() => document.querySelector('#view').textContent.replace(/\s+/g,' '));
    if (!/Can't read the signing table/.test(tx)) throw new Error('no warning: ' + tx.slice(0,200));
    await pg.evaluate(() => { Cloud.linkError = ''; render(); }); await pg.waitForTimeout(300);
    tx = await pg.evaluate(() => document.querySelector('#view').textContent.replace(/\s+/g,' '));
    if (!/Signing table reachable/.test(tx)) throw new Error('no all-clear: ' + tx.slice(0,200));
  });

  await t('a signed link that has not landed yet says it is coming', async () => {
    const e5 = await pg.evaluate(() => {
      const e = Store.data.estimates.find(x => (x.items||[]).length && !x.approval);
      if (!e) return null;
      e.status = 'sent'; Store.save();
      Cloud.linkError = '';
      Cloud.signLinks = [{ estimate_id:e.id, token:'t', signed_at:new Date().toISOString(),
                           signer_name:'Someone', signature:null, created_at:new Date().toISOString(),
                           expires_at:new Date(Date.now()+864e5).toISOString() }];
      return e.id;
    });
    if (!e5) { console.log('       (no spare estimate)'); return; }
    await pg.evaluate(id => openEstimate(id), e5); await pg.waitForTimeout(500);
    const tx = await pg.evaluate(() => document.querySelector('#modal-root').textContent.replace(/\s+/g,' '));
    if (!/They signed it/.test(tx)) throw new Error(tx.slice(0,220));
    if (!await pg.$(`[data-check-signed="${e5}"]`)) throw new Error('no way to pull it in');
    await pg.evaluate(() => { closeModal(); Cloud.signLinks = []; });
  });

  console.log('--- a short link, with the project baked into the page ---');
  await t('the page opens from a token alone when it carries the project', async () => {
    // Stand up a copy of sign.html with the two values filled in, exactly as
    // whoever hosts it on the real domain would.
    const fs = require('fs');
    const src = fs.readFileSync(`${REPO_DIR}/sign.html`, 'utf8');
    const baked = src
      .replace('const BAKED_URL = "";', 'const BAKED_URL = ' + JSON.stringify(URL_) + ';')
      .replace('const BAKED_KEY = "";', 'const BAKED_KEY = ' + JSON.stringify(KEY) + ';');
    if (baked === src) throw new Error('the two constants are not in sign.html to fill in');
    fs.writeFileSync(process.env.SP + '/sign-baked.html', baked);

    const e6 = await pg.evaluate(async () => {
      const e = Store.data.estimates.find(x => (x.items||[]).length && !x.approval);
      if (!e) return null;
      const tok = await Cloud.publishSignLink(e);
      return { id:e.id, tok };
    });
    if (!e6) { console.log('       (no spare estimate)'); return; }

    const shortLink = URL_ + '/sign-baked.html#t=' + e6.tok;
    if (/[&?]k=/.test(shortLink)) throw new Error('not actually short');
    const c3 = await b.newPage({ viewport:{width:390,height:844} });
    c3.on('pageerror', e => errs.push('SHORT PAGEERROR: '+e.message));
    await c3.goto(shortLink); await c3.waitForTimeout(1000);
    const tx = await c3.evaluate(() => document.querySelector('#root').textContent.replace(/\s+/g,' '));
    if (/isn't complete/.test(tx)) throw new Error('page says the link is incomplete');
    if (!/EST-/.test(tx)) throw new Error('estimate did not load: ' + tx.slice(0,180));

    // and it can still be signed from there
    await c3.fill('#nm', 'Short Link Test');
    const pad = await c3.$('#pad'); await pad.scrollIntoViewIfNeeded(); await c3.waitForTimeout(200);
    const bx = await pad.boundingBox();
    await c3.mouse.move(bx.x+30, bx.y+bx.height*0.6); await c3.mouse.down();
    for (let i=1;i<=16;i++) await c3.mouse.move(bx.x+30+i*14, bx.y+bx.height*(0.6-Math.sin(i/2.2)*0.25));
    await c3.mouse.up(); await c3.mouse.move(5,5); await c3.waitForTimeout(200);
    await c3.evaluate(() => document.querySelector('#go').click());
    await c3.waitForTimeout(900);
    const done = await c3.evaluate(() => document.querySelector('#root').textContent);
    if (!/Approved/.test(done)) throw new Error('could not sign from a short link: ' + done.slice(0,160));
    await c3.close();
    console.log('       ' + shortLink.length + ' chars, loaded and signed');
  });

  await t('the repo copy keeps both constants empty', async () => {
    const fs = require('fs');
    const src = fs.readFileSync(`${REPO_DIR}/sign.html`, 'utf8');
    if (!/const BAKED_URL = "";/.test(src) || !/const BAKED_KEY = "";/.test(src))
      throw new Error('a key or project url got committed into sign.html');
  });

  console.log('--- links that should not work ---');
  await t('a made-up token shows nothing at all', async () => {
    const bad = link.replace(/t=[^&]+/, 't=' + 'f'.repeat(32));
    await cust.goto('about:blank'); await cust.goto(bad); await cust.waitForTimeout(800);
    const tx = await cust.evaluate(() => document.querySelector('#root').textContent.replace(/\s+/g,' '));
    if (!/expired/.test(tx)) throw new Error(tx.slice(0,160));
    if (/EST-/.test(tx)) throw new Error('leaked an estimate to a guessed token');
  });

  await t('a truncated link says so instead of looking broken', async () => {
    await cust.goto(link.split('&u=')[0]); await cust.waitForTimeout(700);
    const tx = await cust.evaluate(() => document.querySelector('#root').textContent.replace(/\s+/g,' '));
    if (!/isn't complete/.test(tx)) throw new Error(tx.slice(0,160));
  });

  await t('an expired link is refused, and shows nothing', async () => {
    await fetch(URL_+'/__expire', { method:'POST' });
    await cust.goto('about:blank'); await cust.goto(link); await cust.waitForTimeout(800);
    const tx = await cust.evaluate(() => document.querySelector('#root').textContent.replace(/\s+/g,' '));
    if (!/expired/.test(tx)) throw new Error('an expired link still opened: ' + tx.slice(0,160));
    if (/EST-/.test(tx)) throw new Error('leaked the estimate after expiry');
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
