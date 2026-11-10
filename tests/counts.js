/* Numbers that agree with each other, and say what they count.

   From the Nov 10 check of the live app:
   - An 18-line estimate showed "0 lines" and its send screen said "there
     are no line items on it yet" — its lines were inside an option.
   - The Dashboard said 0 estimates out while the Estimates page said "20
     awaiting signature". The 20 was signing links, not estimates.
   - "Approved" read 4 on the tab and 5 on the card, unlabelled.
   - On opening, totals showed the phone's saved copy for a moment, then
     changed when the sync landed.
   - A lead already dealt with showed no address.
   - There was no Copy button for the message on two of the send screens. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP=`file://${REPO_DIR}/index.html`, errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const ctx = await b.newContext({ viewport:{width:1280,height:1000} });
  await ctx.grantPermissions(['clipboard-read','clipboard-write']);
  const pg = await ctx.newPage();
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await pg.goto(APP); await pg.waitForTimeout(500);
  await pg.evaluate(()=>localStorage.clear()); await pg.reload(); await pg.waitForTimeout(400);

  /* An estimate whose 18 lines all live inside one option. */
  const eid = await pg.evaluate(() => {
    const e = Store.data.estimates.find(x => x.status !== 'approved');
    e.status = 'draft'; delete e.approval; e.chosen = null; e.flatPrice = null; e.items = [];
    e.options = [{ optId: 'opt_a', label: 'The whole job', flatPrice: null, tokens: [],
      items: Array.from({ length: 18 }, (_, i) => ({ desc: 'Line ' + (i+1), kind: 'labor', qty: 1, price: 10 })) }];
    Store.save(); return e.id;
  });

  console.log('--- lines inside an option are lines ---');
  await t('the estimates list counts the lines inside its option', async () => {
    await pg.evaluate(() => { App.estFilter = 'all'; go('estimates'); render(); }); await pg.waitForTimeout(300);
    const row = await pg.$eval(`[data-estimate="${eid}"]`, r => r.textContent.replace(/\s+/g,' '));
    if (!/18 lines · 1 option/.test(row)) throw new Error(row);
  });
  await t('the send screen does not call it empty', async () => {
    await pg.evaluate(i => sendEstimate(i), eid); await pg.waitForTimeout(300);
    const txt = await pg.$eval('.modal', m => m.textContent.replace(/\s+/g,' '));
    if (/no line items/.test(txt)) throw new Error('says it is empty: '+txt.slice(0,200));
    await pg.evaluate(() => closeModal());
  });
  await t('an option with no lines is still named as not ready', async () => {
    const why = await pg.evaluate(i => { const e = Store.estimate(i);
      e.options.push({ optId:'opt_b', label:'Patch only', flatPrice:null, tokens:[], items:[] });
      const w = Store.estNoWorkWhy(e); e.options.pop(); Store.save(); return w; }, eid);
    if (!/Patch only has no line items yet/.test(why)) throw new Error(why);
  });

  console.log('--- counters say what they count ---');
  await t('"with a signing link out" counts estimates, not links, and skips expired ones', async () => {
    const r = await pg.evaluate(i => {
      const later = new Date(Date.now() + 86400000).toISOString(), gone = new Date(Date.now() - 86400000).toISOString();
      const other = Store.data.estimates.find(x => x.id !== i && x.status !== 'approved');
      other.status = 'sent';
      Cloud.signLinks = [
        { token:'a1', estimate_id:i, signed_at:null, expires_at:later },   // option A
        { token:'a2', estimate_id:i, signed_at:null, expires_at:later },   // option B
        { token:'a3', estimate_id:i, signed_at:null, expires_at:later },   // re-sent
        { token:'b1', estimate_id:other.id, signed_at:null, expires_at:gone } // expired
      ];
      Store.save(); go('estimates'); render();
      return document.querySelector('.stat-row').textContent.replace(/\s+/g,' ');
    }, eid);
    if (!/1 with a signing link out/.test(r)) throw new Error(r);
    if (/awaiting signature/.test(r)) throw new Error('still counting links: '+r);
    await pg.evaluate(() => { Cloud.signLinks = []; });
  });
  await t('the Dashboard and the Estimates page give the same number out for decision', async () => {
    const page = await pg.evaluate(() => { go('estimates'); render();
      return [...document.querySelectorAll('.stat')].find(s => /Out for decision/.test(s.textContent)).querySelector('.value').textContent.trim(); });
    const dash = await pg.evaluate(() => { go('dashboard'); render();
      return [...document.querySelectorAll('.stat')].find(s => /out for decision/i.test(s.textContent)).querySelector('.value').textContent.trim(); });
    if (page !== dash) throw new Error('estimates page '+page+' vs dashboard '+dash);
  });
  await t('the two Approved numbers are labelled as the different things they are', async () => {
    const r = await pg.evaluate(() => { go('estimates'); render();
      return { tab: [...document.querySelectorAll('[data-est-filter]')].map(x => x.textContent.trim()).join(' | '),
               card: [...document.querySelectorAll('.stat .label')].map(x => x.textContent.trim()).join(' | ') }; });
    if (!/Approved, not billed/.test(r.tab)) throw new Error(r.tab);
    if (!/Won, all time/.test(r.card)) throw new Error(r.card);
  });

  console.log('--- the phone\'s saved copy says so ---');
  await t('while a signed-in phone has not synced yet, it says so and greys the money', async () => {
    const r = await pg.evaluate(() => {
      Cloud.cfg = { url:'http://127.0.0.1:9', key:'k', refreshToken:'r', deviceId:'T' };
      Cloud.freshAt = 0; Cloud.set('syncing', 'connecting…');
      const n = document.querySelector('#stale-note');
      return { shown: !n.hidden, text: n.textContent, grey: document.body.classList.contains('stale') };
    });
    if (!r.shown || !/saved on this phone — checking for changes/.test(r.text)) throw new Error(JSON.stringify(r));
    if (!r.grey) throw new Error('money not greyed');
  });
  await t('with no connection it says the numbers may be out of date, and when it last synced', async () => {
    const r = await pg.evaluate(() => {
      try { localStorage.setItem('pcp.lastSynced', String(Date.now() - 3600000)); } catch(_){}
      Cloud.set('error', 'no connection — saved on this device');
      return document.querySelector('#stale-note').textContent;
    });
    if (!/Not synced/.test(r) || !/out of date/.test(r) || !/Last synced/.test(r)) throw new Error(r);
  });
  await t('the first good sync takes the note away and the grey off', async () => {
    const r = await pg.evaluate(() => {
      Cloud.set('synced', 'just now');
      const out = { hidden: document.querySelector('#stale-note').hidden, grey: document.body.classList.contains('stale') };
      Cloud.cfg = null; Cloud.freshAt = 0; Cloud.set('off');
      return out;
    });
    if (!r.hidden || r.grey) throw new Error(JSON.stringify(r));
  });
  await t('a phone that is not signed in to sync shows no note at all', async () => {
    const r = await pg.evaluate(() => { renderSync(); return document.querySelector('#stale-note').hidden; });
    if (!r) throw new Error('note shown with no sync set up');
  });

  console.log('--- leads and copying ---');
  await t('a lead already dealt with still shows where the job is', async () => {
    const txt = await pg.evaluate(() => {
      const l = Store.addManualLead({ name:'Pat Example', phone:'7805550199', address:'100 Example St NW' });
      Store.leadDone(l.id, 'none'); go('leads'); render();
      return [...document.querySelectorAll('.lead-done')].map(x => x.textContent.replace(/\s+/g,' ')).join(' | ');
    });
    if (!/Pat Example.*100 Example St NW/.test(txt)) throw new Error(txt);
  });
  await t('the estimate send screen has Copy the message, and it copies the box as edited', async () => {
    await pg.evaluate(i => sendEstimate(i), eid); await pg.waitForTimeout(300);
    await pg.fill('#est-note', 'Hi Pat — edited by hand.');
    await pg.click('[data-copy-box="#est-note"]'); await pg.waitForTimeout(300);
    const clip = await pg.evaluate(() => navigator.clipboard.readText());
    if (clip !== 'Hi Pat — edited by hand.') throw new Error('copied: '+clip);
    const st = await pg.evaluate(i => Store.estimate(i).status, eid);
    if (st !== 'sent') throw new Error('copying did not count as sending, like Text and Email do: '+st);
    await pg.evaluate(() => closeModal());
  });
  await t('the invoice send screen has Copy the message too', async () => {
    const src = require('fs').readFileSync(`${REPO_DIR}/index.html`, 'utf8');
    if (!/data-copy-box="#iv-note">📋 Copy the message/.test(src)) throw new Error('no button');
  });
  await t('the signing-link screen offers Copy the message even with one option', async () => {
    const src = require('fs').readFileSync(`${REPO_DIR}/index.html`, 'utf8');
    if (!/picks\.length > 1 \? "" : `<button class="btn" data-copy-link="\$\{esc\(token\)\}" data-sent-id="\$\{e\.id\}"\s*data-copy-note="1">📋 Copy the message/.test(src))
      throw new Error('no single-option message copy');
  });

  await b.close();
  const hard = errs.filter(e=>e.includes('CONSOLE')||e.includes('PAGEERROR'));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
