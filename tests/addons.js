/* Add-ons: priced up front, done only if needed, signed for then.

   Nov 25 (invented names here): a main-line estimate with two options —
   camera and auger $700, or auger only $350 — and a $100 toilet pull and
   reset needed only if there's no clean-out access. As a third option it
   read like a competing choice and was declined the moment she signed
   one of the others, with no way to offer it again. Now it's an add-on:
   shown, priced, under every option, outside the total, nothing to pick;
   on the job, "They want it" turns it into a change of scope she signs
   then, billed on the same invoice.                                     */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const fs = require('fs');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP='http://127.0.0.1:54321/index.html', URL_='http://127.0.0.1:54321', KEY='sb_publishable_test';
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  await fetch(URL_+'/__reset');

  const src = fs.readFileSync(`${REPO_DIR}/sign.html`, 'utf8');
  const baked = src.replace(/const BAKED_URL = "[^"]*";/, 'const BAKED_URL = ' + JSON.stringify(URL_) + ';')
                   .replace(/const BAKED_KEY = "[^"]*";/, 'const BAKED_KEY = ' + JSON.stringify(KEY) + ';');
  const PAGE = (process.env.SP || __dirname) + '/sign-baked-addons.html';
  fs.writeFileSync(PAGE, baked);
  const pageUrl = URL_ + '/' + require('path').basename(PAGE);

  const pg = await b.newPage({ viewport:{width:1280,height:1000} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text())});
  await pg.goto(APP); await pg.waitForTimeout(400);
  await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'T'}; Cloud.saveCfg();
    return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY]);
  await pg.waitForTimeout(800);

  const eid = await pg.evaluate(() => {
    Object.assign(Store.data.settings, { gst:'', gstRate:0 });
    const e = { id: uid('est'), no: 7201, createdAt: Date.now(), status:'draft', type:'Drain Cleaning', service:'main line',
      description:'Main line backing up', validDays:30, customerId: Store.data.customers[0].id, items:[], flatPrice:null,
      materials:[], timeEntries:[], photos:[], log:[], visitDate:null, window:'Anytime', techId:null, scopeOf:null, options:[], chosen:null };
    Store.data.estimates.push(e);
    const a = Store.addEstOption(e); a.label = 'Camera and auger'; a.items = [{ desc:'Camera and auger the main', kind:'flat', qty:1, price:700 }];
    const c = Store.addEstOption(e); c.label = 'Auger only';       c.items = [{ desc:'Auger the main', kind:'flat', qty:1, price:350 }];
    Store.save(); return e.id;
  });
  const est = () => pg.evaluate(i => Store.estimate(i), eid);

  console.log('--- on the estimate ---');
  await t('an add-on goes on in its own section, and neither option\'s price moves', async () => {
    await pg.evaluate(i => { closeModal(); openEstimate(i); }, eid); await pg.waitForTimeout(400);
    await pg.fill('#addon-desc', 'Toilet pull and reset, if there is no clean-out access');
    await pg.fill('#addon-price', '100');
    await pg.click(`[data-addon-add="${eid}"]`); await pg.waitForTimeout(400);
    const e = await est();
    if ((e.addOns || []).length !== 1 || e.addOns[0].price !== 100) throw new Error(JSON.stringify(e.addOns));
    const r = await pg.evaluate(i => Store.estimateRange(Store.estimate(i)), eid);
    if (!r || r.lo !== 350 || r.hi !== 700) throw new Error('prices moved: ' + JSON.stringify(r));
  });
  await t('the printed estimate shows it under the price, marked only if needed', async () => {
    const doc = await pg.evaluate(i => estimateDocHtml(Store.estimate(i)), eid);
    if (!/Only if needed/.test(doc) || !/Toilet pull and reset/.test(doc) || !/\$100\.00/.test(doc)) throw new Error('not on the printed sheet');
    if (!/sign for it separately/.test(doc)) throw new Error('does not say it needs her OK');
  });

  console.log('--- what she sees ---');
  let toks;
  await t('her "two ways" page shows the add-on, and offers only the two real choices to pick', async () => {
    toks = await pg.evaluate(async i => (await Cloud.publishSignLinks(Store.estimate(i))).map(p => p.token), eid);
    const c = await b.newPage({ viewport:{width:390,height:844} });
    c.on('pageerror', e => errs.push('CUSTOMER PAGEERROR: '+e.message));
    await c.goto(pageUrl + '#t=' + toks[0]); await c.waitForTimeout(1100);
    const txt = await c.evaluate(() => document.querySelector('#root').innerText.replace(/\s+/g,' '));
    if (!/Only if needed/.test(txt) || !/Toilet pull and reset/.test(txt) || !/\$100\.00/.test(txt)) throw new Error(txt.slice(0, 400));
    if (process.env.SHOT) await c.screenshot({ path: process.env.SHOT, fullPage: true });
    const picks = await c.$$eval('[data-pick]', x => x.length);
    if (picks !== 2) throw new Error(picks + ' things to pick — the add-on must not be one');
    await c.click('[data-pick]'); await c.waitForTimeout(900);
    const detail = await c.evaluate(() => document.querySelector('#root').innerText.replace(/\s+/g,' '));
    if (!/Only if needed/.test(detail)) throw new Error('not shown under the option she opened');
    if (!/Total \$700\.00/.test(detail)) throw new Error('the add-on got into the total: ' + detail.slice(0, 300));
    await c.close();
  });
  await t('an estimate with no add-ons sends exactly what it always did', async () => {
    const other = await pg.evaluate(async () => {
      const e = { id: uid('est'), no: 7202, createdAt: Date.now(), status:'draft', type:'Leak Repair', service:'',
        description:'Drip under the sink', validDays:30, customerId: Store.data.customers[0].id,
        items:[{ desc:'Replace the trap', kind:'labor', qty:1, price:145 }], flatPrice:null,
        materials:[], timeEntries:[], photos:[], log:[], visitDate:null, window:'Anytime', techId:null, scopeOf:null, chosen:null };
      Store.data.estimates.push(e); Store.save();
      await Cloud.publishSignLinks(e);
      return e.id;
    });
    const rows = (await fetch(URL_+'/__links').then(r => r.json())).filter(r => r.estimate_id === other);
    if (!rows.length) throw new Error('nothing published, so this proves nothing');
    if (rows.some(r => 'addOns' in r.payload)) throw new Error('payload grew an addOns key');
  });

  console.log('--- on the job ---');
  let jid;
  await t('signed for, the job lists the add-on with "They want it"', async () => {
    jid = await pg.evaluate(i => {
      const e = Store.estimate(i), o = Store.estOptions(e)[0];
      Store.signEstimate(e, { name:'Pat Example', role:'Homeowner', signature:'data:image/png;base64,' + 'A'.repeat(300), optId: o.optId });
      return (Store.data.jobs.find(j => j.estimateId === i) || {}).id;
    }, eid);
    if (!jid) throw new Error('no job made');
    await pg.evaluate(id => { closeModal(); openJob(id); }, jid); await pg.waitForTimeout(400);
    const tx = await pg.$eval('.modal', e => e.innerText.replace(/\s+/g,' '));
    // section titles are shown in capitals, so innerText reads "ADD-ONS QUOTED"
    if (!/Add-ons quoted/i.test(tx) || !/Toilet pull and reset/.test(tx)) throw new Error(tx.slice(0, 300));
    if (!await pg.$('[data-addon-want]')) throw new Error('no They want it');
  });
  let sid;
  await t('"They want it" makes a change of scope at the quoted price, once', async () => {
    await pg.click('[data-addon-want]'); await pg.waitForTimeout(500);
    const s = await pg.evaluate(id => Store.data.estimates.find(e => e.scopeOf === id), jid);
    if (!s) throw new Error('no change of scope');
    if (s.items.length !== 1 || s.items[0].price !== 100 || !/Toilet pull/.test(s.items[0].desc)) throw new Error(JSON.stringify(s.items));
    sid = s.id;
    await pg.evaluate(id => { closeModal(); openJob(id); }, jid); await pg.waitForTimeout(400);
    if (await pg.$('[data-addon-want]')) throw new Error('offered again — a second one would double-bill');
    const tx = await pg.$eval('.modal', e => e.innerText);
    if (!new RegExp('EST-' + s.no).test(tx)) throw new Error('does not point at the change of scope');
  });
  await t('signed on the day, the $100 lands on the same invoice', async () => {
    const r = await pg.evaluate(([j, s]) => {
      const parent = Store.job(j);
      const before = Store.billedTotal(parent);
      Store.signEstimate(Store.estimate(s), { name:'Pat Example', role:'Homeowner', signature:'data:image/png;base64,' + 'A'.repeat(300) });
      return { before, after: Store.billedTotal(parent) };
    }, [jid, sid]);
    if (Math.abs(r.after - r.before - 100) > 0.005) throw new Error(JSON.stringify(r));
  });
  await t('if that change of scope is deleted, the add-on can be offered again', async () => {
    const r = await pg.evaluate(([j, s]) => {
      Store.data.estimates = Store.data.estimates.filter(e => e.id !== s);
      const a = Store.job(j).addOns[0];
      return !!Store.addOnToScope(Store.job(j), a.id);
    }, [jid, sid]);
    if (!r) throw new Error('stuck as used');
  });

  await b.close();
  try { fs.unlinkSync(PAGE); } catch(_){}
  const hard = errs.filter(e=>e.includes('CONSOLE')||e.includes('PAGEERROR'));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
