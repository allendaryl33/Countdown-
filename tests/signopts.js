/* What the customer actually sees when there are two prices.

   This drives the real sign.html, the page that lives on his own domain, the
   way she would on her phone: she gets one link, sees both ways of doing it
   with the cost beside each, taps one, reads the whole estimate for that one
   and signs it.

   The promise the page makes is the thing being tested. It tells her in
   writing that approving one closes the others off. So: the other link must
   not still be signable afterwards, and whichever link she opens next has to
   say so rather than offering her a second thing to agree to.                */

const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP='http://127.0.0.1:54321/index.html', URL_='http://127.0.0.1:54321', KEY='sb_publishable_test';
const fs = require('fs');
const errs=[];

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  await fetch(URL_+'/__reset');

  /* The page as whoever hosts it would have it: the project baked in. */
  const src = fs.readFileSync(`${REPO_DIR}/sign.html`, 'utf8');
  const baked = src
    .replace(/const BAKED_URL = "[^"]*";/, 'const BAKED_URL = ' + JSON.stringify(URL_) + ';')
    .replace(/const BAKED_KEY = "[^"]*";/, 'const BAKED_KEY = ' + JSON.stringify(KEY) + ';');
  if (baked === src) throw new Error('the two constants are not in sign.html to swap');
  const PAGE = (process.env.SP || __dirname) + '/sign-baked-opts.html';
  fs.writeFileSync(PAGE, baked);
  const pageUrl = URL_ + '/' + require('path').basename(PAGE);

  const pg = await b.newPage({ viewport:{width:1280,height:1000} });
  pg.on('pageerror',e=>errs.push('APP PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('APP CONSOLE: '+m.text())});
  await pg.goto(APP); await pg.waitForTimeout(400);
  await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'T'}; Cloud.saveCfg();
    return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY]);
  await pg.waitForTimeout(900);

  /* Chelsea's shower: patch it, or rebuild it. */
  const made = await pg.evaluate(async () => {
    Object.assign(Store.data.settings, { gst:'', gstRate:0 });
    const e = { id: uid('est'), no: 7001, createdAt: Date.now(), status:'draft',
      type:'Other', service:'shower rebuild', description:'Leaking shower, second floor',
      validDays:30, customerId: Store.data.customers[0].id, items:[], flatPrice:null,
      materials:[], timeEntries:[], photos:[], log:[], visitDate:null,
      window:'Anytime', techId:null, scopeOf:null, options:[], chosen:null };
    Store.data.estimates.push(e);
    const a = Store.addEstOption(e);
    a.label = 'Patch the valve';
    a.items = [{ desc:'Replace the mixing valve', kind:'labour', qty:3, price:145 },
               { desc:'Valve cartridge',          kind:'part',   qty:1, price:165 }];
    const c = Store.addEstOption(e);
    c.label = 'Rebuild the whole shower';
    c.items = [{ desc:'Strip and rebuild, tile to drain', kind:'labour', qty:1, price:8400 }];
    Store.save();
    const picks = await Cloud.publishSignLinks(e);
    return { id: e.id, toks: picks.map(p => p.token),
             labels: picks.map(p => Store.estOptLabel(e, p.opt)) };
  });
  if (!made || made.toks.length !== 2) throw new Error('setup did not make two links');
  const [tokA, tokB] = made.toks;

  const openCust = async tok => {
    const c = await b.newPage({ viewport:{width:390,height:844} });
    c.on('pageerror', e => errs.push('CUSTOMER PAGEERROR: '+e.message));
    c.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('CUSTOMER CONSOLE: '+m.text())});
    await c.goto(pageUrl + '#t=' + tok); await c.waitForTimeout(1100);
    return c;
  };
  const txt = c => c.evaluate(() => document.querySelector('#root').textContent.replace(/\s+/g,' '));

  console.log('--- one link, both prices ---');

  let cust = null;
  await t('her link opens on the choice, with the cost beside each one', async () => {
    cust = await openCust(tokA);
    const x = await txt(cust);
    if (/isn't complete/.test(x)) throw new Error('page says the link is incomplete');
    if (!/EST-7001/.test(x)) throw new Error('it did not load: ' + x.slice(0,200));
    if (!/Patch the valve/.test(x)) throw new Error('first option missing: ' + x.slice(0,300));
    if (!/Rebuild the whole shower/.test(x)) throw new Error('second option missing: ' + x.slice(0,300));
    if (!/\$600/.test(x)) throw new Error('the patch price is not on it: ' + x.slice(0,300));
    if (!/\$8,400/.test(x)) throw new Error('the rebuild price is not on it: ' + x.slice(0,300));
    const n = await cust.evaluate(() => document.querySelectorAll('[data-pick]').length);
    if (n !== 2) throw new Error(n + ' thing(s) to tap');
  });

  await t('and it tells her in writing that approving one closes the others', async () => {
    const x = await txt(cust);
    if (!/close off automatically|closes off/i.test(x))
      throw new Error('no such promise on the page: ' + x.slice(0,400));
  });

  await t('nothing is signable from the choice itself — she has to open one first', async () => {
    const r = await cust.evaluate(() => ({
      pad: !!document.querySelector('#pad'), go: !!document.querySelector('#go')
    }));
    if (r.pad || r.go) throw new Error('there is a signature pad on the chooser');
  });

  await t('tapping the dearer one shows that estimate in full, and only that one', async () => {
    await cust.evaluate(() => {
      const n = [...document.querySelectorAll('[data-pick]')]
        .find(x => /Rebuild/.test(x.textContent));
      n.click();
    });
    await cust.waitForTimeout(900);
    const x = await txt(cust);
    if (!/Strip and rebuild/.test(x)) throw new Error("the rebuild's work is not shown: " + x.slice(0,300));
    if (/mixing valve/i.test(x)) throw new Error('it is showing both scopes as one agreement');
    if (!/\$8,400/.test(x)) throw new Error('wrong total on screen: ' + x.slice(0,300));
    if (!/Rebuild the whole shower/.test(x)) throw new Error('it does not say which option this is');
    const r = await cust.evaluate(() => ({ pad: !!document.querySelector('#pad'),
                                           back: !!document.querySelector('#back') }));
    if (!r.pad) throw new Error('nowhere to sign');
    if (!r.back) throw new Error('no way back to the other option');
  });

  await t('she can go back and look at the other one again', async () => {
    await cust.evaluate(() => document.querySelector('#back').click());
    await cust.waitForTimeout(500);
    const x = await txt(cust);
    if (!/Patch the valve/.test(x) || !/Rebuild the whole shower/.test(x))
      throw new Error('back did not return to the choice: ' + x.slice(0,250));
    await cust.evaluate(() => {
      [...document.querySelectorAll('[data-pick]')].find(x => /Patch/.test(x.textContent)).click();
    });
    await cust.waitForTimeout(800);
    const y = await txt(cust);
    if (!/mixing valve/i.test(y)) throw new Error('the patch option did not open: ' + y.slice(0,250));
    if (!/\$600/.test(y)) throw new Error('wrong total for the patch: ' + y.slice(0,250));
  });

  console.log('--- she signs the one she wants ---');

  await t('signing the one on screen signs that one, not the link she arrived on', async () => {
    // She arrived on tokA and is now looking at the patch option. Whichever
    // that is, what gets signed must be what she is reading.
    await cust.fill('#nm', 'Chelsea Ward');
    const pad = await cust.$('#pad'); await pad.scrollIntoViewIfNeeded(); await cust.waitForTimeout(200);
    const bx = await pad.boundingBox();
    await cust.mouse.move(bx.x+30, bx.y+bx.height*0.6); await cust.mouse.down();
    for (let i=1;i<=16;i++) await cust.mouse.move(bx.x+30+i*14, bx.y+bx.height*(0.6-Math.sin(i/2.2)*0.25));
    await cust.mouse.up(); await cust.mouse.move(5,5); await cust.waitForTimeout(200);
    await cust.evaluate(() => document.querySelector('#go').click());
    await cust.waitForTimeout(1200);
    const x = await txt(cust);
    if (!/Approved/.test(x)) throw new Error('it did not go through: ' + x.slice(0,250));

    const rows = await fetch(URL_+'/__links').then(r=>r.json());
    const signed = rows.filter(r => made.toks.includes(r.token) && r.signed_at);
    if (signed.length !== 1) throw new Error(signed.length + ' of the two rows are signed');
    if (!/Patch the valve/.test(signed[0].payload.option || ''))
      throw new Error('the wrong option got signed: ' + signed[0].payload.option);
    if (Math.round(signed[0].payload.total) !== 600)
      throw new Error('signed row holds ' + signed[0].payload.total);
  });

  await t('the app brings back the option she chose and closes the other', async () => {
    await pg.evaluate(() => Cloud.pullSignLinks()); await pg.waitForTimeout(1000);
    const e = await pg.evaluate(i => {
      const e = Store.estimate(i);
      return { approval: e.approval, chosen: Store.estOptLabel(e, Store.estChosen(e)),
               otherGone: !!e.options.find(o => o.label === 'Rebuild the whole shower').declinedAt,
               quoted: e.jobId ? Store.job(e.jobId).quotedTotal : null };
    }, made.id);
    if (!e.approval) throw new Error('nothing came back');
    if (e.chosen !== 'Patch the valve') throw new Error('it recorded ' + e.chosen);
    if (e.approval.total !== 600) throw new Error('frozen at ' + e.approval.total);
    if (!e.otherGone) throw new Error('the rebuild is still live');
    if (e.quoted !== 600) throw new Error('the job was quoted at ' + e.quoted);
  });

  console.log('--- and the other link keeps the page\'s word ---');

  await t("the option she turned down says so, and offers nothing to sign", async () => {
    await cust.close();
    const other = await openCust(tokB);
    const x = await txt(other);
    if (!/Already approved/i.test(x))
      throw new Error('it still offers the other price: ' + x.slice(0,300));
    if (!/Patch the valve/.test(x))
      throw new Error('it does not say which one she approved: ' + x.slice(0,300));
    const r = await other.evaluate(() => ({ pad: !!document.querySelector('#pad'),
                                            pick: document.querySelectorAll('[data-pick]').length }));
    if (r.pad) throw new Error('there is still a signature pad on it');
    if (r.pick) throw new Error('it is still offering a choice after one was signed');
    await other.close();
  });

  /* The page re-checks the other links before it submits, which covers
     every ordinary case. This is the case it does not: somebody going
     straight at the RPC, or two phones inside the same second. The page's
     promise is in writing, so the database has to be what keeps it.

     This models supabase-estimate-options.sql. If that has not been run in
     the real project, the page guard is all there is — which is good, but
     not what the page says. */
  await t("and the database refuses a second signature on the same estimate", async () => {
    const png = 'data:image/png;base64,' + 'A'.repeat(300);
    const r = await fetch(URL_+'/rest/v1/rpc/sign_estimate', {
      method:'POST', headers:{ 'apikey':KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({ p_token: tokB, p_name:'Someone Else', p_role:'Tenant', p_signature:png })
    }).then(x=>x.json());
    if (!r) throw new Error('no answer from the RPC at all');
    if (r.ok) throw new Error('it signed the second option too');
    if (!/already been approved/i.test(r.reason || ''))
      throw new Error('refused for the wrong reason: ' + JSON.stringify(r));
    const rows = await fetch(URL_+'/__links').then(x=>x.json());
    const n = rows.filter(x => made.toks.includes(x.token) && x.signed_at).length;
    if (n !== 1) throw new Error(n + ' of the two rows are signed');
  });

  console.log('--- an estimate with one price is untouched ---');

  await t('a plain estimate still opens straight onto itself, no chooser', async () => {
    const tok = await pg.evaluate(async () => {
      const e = Store.data.estimates.find(x => !x.options && (x.items||[]).length && !x.approval);
      if (!e) return null;
      const picks = await Cloud.publishSignLinks(e);
      return picks[0].token;
    });
    if (!tok) { console.log('       (no plain estimate left in the shop)'); return; }
    const c = await openCust(tok);
    const r = await c.evaluate(() => ({
      pick: document.querySelectorAll('[data-pick]').length,
      pad: !!document.querySelector('#pad'),
      back: !!document.querySelector('#back'),
      x: document.querySelector('#root').textContent.replace(/\s+/g,' ')
    }));
    if (r.pick) throw new Error('it put a chooser in front of a single-price estimate');
    if (!r.pad) throw new Error('no signature pad: ' + r.x.slice(0,200));
    if (r.back) throw new Error('a back link to options that do not exist');
    await c.close();
  });

  try { fs.unlinkSync(PAGE); } catch(_){}
  await b.close();
  console.log('\n=== failures: ' + errs.length + ' ===');
  errs.forEach(e => console.log('  - ' + e));
  if (errs.length) process.exit(1);
  console.log('all good');
})();
