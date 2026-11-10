/* Making a quote read the way he sells it. From the Nov 9 backlog, a
   camera job (invented here as "Pat Example" for "Example Arts Society"):

   - A flat $350 including two hours on site. The app only knew qty × price,
     so it read as 2 × $175 an hour — hourly — or as "1 hr" while the words
     said two. A Flat rate line is now one amount.
   - Two flat-rate lines were meant to stand out as section subtotals, and
     there was no bold. ALL CAPS went to the customer.
   - The quote was for a company at a named place, and both had to be typed
     into the scope. The quote still goes TO the person.
   - Tags (Labor / Material / Sub / Flat rate) should at least split a job's
     money by kind.
   - The Email button opened the phone's personal mail app.            */
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
  const baked = src
    .replace(/const BAKED_URL = "[^"]*";/, 'const BAKED_URL = ' + JSON.stringify(URL_) + ';')
    .replace(/const BAKED_KEY = "[^"]*";/, 'const BAKED_KEY = ' + JSON.stringify(KEY) + ';');
  if (baked === src) throw new Error('the two constants are not in sign.html to swap');
  const PAGE = (process.env.SP || __dirname) + '/sign-baked-lines.html';
  fs.writeFileSync(PAGE, baked);
  const pageUrl = URL_ + '/' + require('path').basename(PAGE);

  const pg = await b.newPage({ viewport:{width:1280,height:1000} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text())});
  await pg.goto(APP); await pg.waitForTimeout(400);
  await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'T'}; Cloud.saveCfg();
    return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY]);
  await pg.waitForTimeout(900);

  const ids = await pg.evaluate(() => {
    Object.assign(Store.data.settings, { gst:'', gstRate:0, email:'office@example.com', mailVia:'device' });
    const c = { id: uid('cus'), createdAt: Date.now(), name:'Pat Example', phone:'7805550199',
      email:'pat@example.com', address:'100 Example St NW', city:'Edmonton', zone:'city', notes:'' };
    Store.data.customers.push(c);
    const e = { id: uid('est'), no: 7101, createdAt: Date.now(), status:'draft',
      type:'Other', service:'camera inspection', description:'Camera the main line',
      validDays:30, customerId: c.id, items:[], flatPrice:null,
      materials:[], timeEntries:[], photos:[], log:[], visitDate:null,
      window:'Anytime', techId:null, scopeOf:null, chosen:null };
    Store.data.estimates.push(e);
    Store.save();
    return { cid: c.id, eid: e.id };
  });
  const { cid, eid } = ids;
  const est = () => pg.evaluate(i => Store.estimate(i), eid);
  const open = async () => { await pg.evaluate(i => { closeModal(); openEstimate(i); }, eid); await pg.waitForTimeout(400); };

  console.log('--- a flat-rate line is one amount ---');
  await t('picking Flat rate drops the quantity box and calls the price "Amount"', async () => {
    await open();
    await pg.selectOption('#line-kind', 'flat'); await pg.waitForTimeout(100);
    if (await pg.$eval('#line-qty-f', e => getComputedStyle(e).display) !== 'none') throw new Error('qty still showing');
    if (await pg.$eval('#line-price-l', e => e.textContent) !== 'Amount') throw new Error('label not Amount');
  });
  await t('a flat $350 camera line goes on as one $350 line, quantity 1', async () => {
    await pg.fill('#line-desc', 'Sewer camera inspection — includes 2 hours on site, flat rate');
    await pg.fill('#line-price', '350');
    await pg.click(`[data-add-line="${eid}"]`); await pg.waitForTimeout(400);
    const it = (await est()).items[0];
    if (it.kind !== 'flat' || it.qty !== 1 || it.price !== 350) throw new Error(JSON.stringify(it));
    const cell = await pg.$eval('[data-line-row="0"] td:nth-child(3)', e => e.textContent.trim());
    if (cell !== 'flat') throw new Error('quantity cell reads '+cell);
  });
  await t('an hourly line switched to Flat rate becomes one amount worth the same', async () => {
    await pg.evaluate(i => { const e = Store.estimate(i);
      e.items.push({ desc:'Locate and mark — flat rate', kind:'labor', qty:2, price:175 }); Store.save(); }, eid);
    await open();
    await pg.selectOption(`[data-line-edit="${eid}:1:kind"]`, 'flat'); await pg.waitForTimeout(400);
    const it = (await est()).items[1];
    if (it.kind !== 'flat' || it.qty !== 1 || it.price !== 350) throw new Error(JSON.stringify(it));
    if (await pg.$eval('[data-est-total]', e => e.textContent.trim()) !== '$700.00') throw new Error('total moved');
  });
  await t('the printed estimate shows no quantity, no hours and no hourly price on a flat line', async () => {
    const doc = await pg.evaluate(i => estimateDocHtml(Store.estimate(i)), eid);
    const row = (doc.match(/Sewer camera inspection[\s\S]*?<\/tr>/) || [''])[0];
    if (!/\$350\.00/.test(row)) throw new Error('no amount: '+row);
    if (/\bhr\b|\$175|>1</.test(row)) throw new Error('reads hourly: '+row);
  });

  console.log('--- bold ---');
  await t('a line can be made bold, and the printed estimate prints it bold', async () => {
    await open();
    await pg.click(`[data-line-bold="${eid}:0"]`); await pg.waitForTimeout(400);
    if (!(await est()).items[0].bold) throw new Error('not stored');
    if (!await pg.$('[data-line-edit$=":0:desc"].li-bold')) throw new Error('editor not bold');
    const doc = await pg.evaluate(i => estimateDocHtml(Store.estimate(i)), eid);
    if (!/<strong>Sewer camera inspection/.test(doc)) throw new Error('printed plain');
    if (/<strong>Locate and mark/.test(doc)) throw new Error('the other line went bold too');
  });
  await t('tapping B again puts it back to plain, with no flag left behind', async () => {
    await pg.click(`[data-line-bold="${eid}:0"]`); await pg.waitForTimeout(400);
    if ('bold' in (await est()).items[0]) throw new Error('flag left');
    await pg.click(`[data-line-bold="${eid}:0"]`); await pg.waitForTimeout(400);
  });

  console.log('--- the company and the place ---');
  await t('the customer form takes a company and a place name, apart from the address', async () => {
    await pg.evaluate(i => { closeModal(); openCustomerForm(i); }, cid); await pg.waitForTimeout(300);
    await pg.fill('#c-company', 'Example Arts Society');
    await pg.fill('#c-site', 'Example House');
    await pg.click('[data-save-customer]'); await pg.waitForTimeout(300);
    const c = await pg.evaluate(i => Store.customer(i), cid);
    if (c.company !== 'Example Arts Society' || c.site !== 'Example House') throw new Error(JSON.stringify(c));
    if (c.name !== 'Pat Example' || c.address !== '100 Example St NW') throw new Error('name or address moved: '+JSON.stringify(c));
  });
  await t('the printed estimate is prepared for the person, with the company under the name', async () => {
    const doc = await pg.evaluate(i => estimateDocHtml(Store.estimate(i)), eid);
    const m = doc.match(/Prepared for<\/strong><\/td>\s*<td>([\s\S]*?)<\/td>/);
    if (!m) throw new Error('no Prepared for row');
    if (!/^Pat Example/.test(m[1].trim())) throw new Error('not addressed to the person first: '+m[1]);
    if (!/Example Arts Society/.test(m[1])) throw new Error('company missing: '+m[1]);
    if (!/Example House[\s\S]*100 Example St NW/.test(doc)) throw new Error('place name not with the address');
  });
  await t('a company or place name finds the customer in search', async () => {
    const n = await pg.evaluate(() => { App.search = 'example house'; render();
      const x = document.querySelector('#view').textContent; App.search = ''; render(); return x; });
    if (!/Pat Example/.test(n)) throw new Error('not found');
  });

  console.log('--- what the customer gets ---');
  await t('her signing page shows the bold line bold, the flat line as one amount, and who it is for', async () => {
    const tok = await pg.evaluate(async i => {
      const picks = await Cloud.publishSignLinks(Store.estimate(i));
      return picks[0].token;
    }, eid);
    const c = await b.newPage({ viewport:{width:390,height:844} });
    c.on('pageerror', e => errs.push('CUSTOMER PAGEERROR: '+e.message));
    await c.goto(pageUrl + '#t=' + tok); await c.waitForTimeout(1100);
    const html = await c.evaluate(() => document.querySelector('#root').innerHTML);
    const txt = await c.evaluate(() => document.querySelector('#root').textContent.replace(/\s+/g,' '));
    if (!/<strong>Sewer camera inspection/.test(html)) throw new Error('not bold for her');
    if (/1 ×|×\s*Sewer|\$175/.test(txt)) throw new Error('reads hourly for her: '+txt.slice(0,300));
    if (!/Pat Example\s*Example Arts Society/.test(txt)) throw new Error('prepared-for block: '+txt.slice(0,300));
    if (!/Example House/.test(txt)) throw new Error('place name missing');
    await c.close();
  });
  await t('a non-bold line in the published payload carries exactly what it always did', async () => {
    const rows = await fetch(URL_+'/__links').then(x=>x.json());
    const mine = rows.filter(r => r.estimate_id === eid).pop();
    const plain = mine.payload.items.find(i => /Locate/.test(i.desc));
    if (Object.keys(plain).sort().join(',') !== 'desc,price,qty') throw new Error(JSON.stringify(plain));
  });

  console.log('--- splitting the money by kind ---');
  await t('the estimate adds its lines up by kind', async () => {
    await pg.evaluate(i => { const e = Store.estimate(i);
      e.items.push({ desc:'Tile, subcontracted', kind:'sub', qty:1, price:1200 },
                   { desc:'Fittings', kind:'part', qty:2, price:12.5 }); Store.save(); }, eid);
    await open();
    const s = await pg.$eval('.kind-split', e => e.textContent.replace(/\s+/g,' '));
    if (!/Material \/ Parts \$25\.00 · Sub \$1,200\.00 · Flat rate \$700\.00/.test(s)) throw new Error(s);
  });
  await t('the job made from it keeps the tags, and a part added untagged reads "Not tagged"', async () => {
    const jid = await pg.evaluate(i => {
      const e = Store.estimate(i);
      Store.convertEstimate(e, { customerId: e.customerId, scheduledDate: todayStr(), window:'Anytime', priority:'Normal' });
      return Store.data.jobs.find(j => j.estimateId === i).id;
    }, eid);
    await pg.evaluate(i => { closeModal(); openJob(i); }, jid); await pg.waitForTimeout(400);
    if (await pg.$eval('#part-kind', e => e.value) !== '') throw new Error('new part pre-tagged — a guess');
    await pg.fill('#part-desc', 'Extra fitting'); await pg.fill('#part-qty', '1'); await pg.fill('#part-price', '9');
    await pg.click(`[data-add-part="${jid}"]`); await pg.waitForTimeout(400);
    const s = await pg.$eval('.kind-split', e => e.textContent.replace(/\s+/g,' '));
    if (!/Sub \$1,200\.00/.test(s) || !/Not tagged \$9\.00/.test(s)) throw new Error(s);
    const lines = await pg.evaluate(i => Store.invoiceLines(Store.job(i)), jid);
    if (lines.some(l => 'kind' in l || 'bold' in l)) throw new Error('a tag reached the invoice lines');
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
  });

  /* EST-2010's shape: bold section titles and work steps with no price,
     one Flat rate line carrying the section price. Before, the customer saw
     "$0.00" beside 18 of 21 lines. */
  console.log('--- lines with no price show no price ---');
  let e2;
  await t('Text is on the tag list, and a Text line has no quantity or price box', async () => {
    e2 = await pg.evaluate(cid => {
      const e = { id: uid('est'), no: 7110, createdAt: Date.now(), status:'draft',
        type:'Other', service:'water softener install', description:'Softener install',
        validDays:30, customerId: cid, items:[], flatPrice:null,
        materials:[], timeEntries:[], photos:[], log:[], visitDate:null,
        window:'Anytime', techId:null, scopeOf:null, chosen:null };
      Store.data.estimates.push(e); Store.save(); return e.id;
    }, cid);
    await pg.evaluate(i => { closeModal(); openEstimate(i); }, e2); await pg.waitForTimeout(400);
    const kinds = await pg.$$eval('#line-kind option', os => os.map(o => o.value).join(','));
    if (kinds !== 'labor,part,sub,flat,text') throw new Error(kinds);
    await pg.selectOption('#line-kind', 'text'); await pg.waitForTimeout(100);
    const hidden = await pg.evaluate(() => [getComputedStyle(document.querySelector('#line-qty-f')).display,
                                            getComputedStyle(document.querySelector('#line-price-f')).display]);
    if (hidden.join() !== 'none,none') throw new Error('boxes still showing: ' + hidden);
    await pg.fill('#line-desc', 'SOFTENER INSTALL');
    await pg.click(`[data-add-line="${e2}"]`); await pg.waitForTimeout(400);
    const it = await pg.evaluate(i => Store.estimate(i).items[0], e2);
    if (it.kind !== 'text' || it.qty !== 1 || it.price !== 0) throw new Error(JSON.stringify(it));
    const row = await pg.$eval('[data-line-row="0"]', r => r.textContent.replace(/\s+/g,' '));
    if (!/text/.test(row) || !/no price/.test(row) || /\$0\.00/.test(row)) throw new Error(row);
  });
  await t('a line with a price on it is not turned into Text — the money stays', async () => {
    await pg.evaluate(i => { const e = Store.estimate(i);
      e.items.push({ desc:'Softener install — flat rate', kind:'flat', qty:1, price:1450 }); Store.save(); }, e2);
    await pg.evaluate(i => { closeModal(); openEstimate(i); }, e2); await pg.waitForTimeout(400);
    await pg.selectOption(`[data-line-edit="${e2}:1:kind"]`, 'text'); await pg.waitForTimeout(300);
    const it = await pg.evaluate(i => Store.estimate(i).items[1], e2);
    if (it.kind !== 'flat' || it.price !== 1450) throw new Error('rewritten: ' + JSON.stringify(it));
  });
  await t('the printed estimate shows no $0.00 — old $0 lines included', async () => {
    await pg.evaluate(i => { const e = Store.estimate(i);
      // the way EST-2010 was built before Text existed
      e.items.splice(1, 0, { desc:'Shut off and drain', kind:'labor', qty:1, price:0 },
                           { desc:'Install bypass',     kind:'part',  qty:1, price:0 });
      Store.save(); }, e2);
    const doc = await pg.evaluate(i => estimateDocHtml(Store.estimate(i)), e2);
    if (/\$0\.00/.test(doc)) throw new Error('a $0.00 is printed');
    if (!/Shut off and drain/.test(doc) || !/\$1,450\.00/.test(doc)) throw new Error('lost a line or the price');
  });
  await t('her signing page shows the steps as words and only the flat rate as money', async () => {
    const tok = await pg.evaluate(async i => (await Cloud.publishSignLinks(Store.estimate(i)))[0].token, e2);
    const c = await b.newPage({ viewport:{width:390,height:844} });
    c.on('pageerror', e => errs.push('CUSTOMER PAGEERROR: '+e.message));
    await c.goto(pageUrl + '#t=' + tok); await c.waitForTimeout(1100);
    const txt = await c.evaluate(() => document.querySelector('#root').textContent.replace(/\s+/g,' '));
    if (/\$0\.00/.test(txt)) throw new Error('$0.00 on her page: ' + txt.slice(0,300));
    for (const w of ['SOFTENER INSTALL','Shut off and drain','Install bypass','$1,450.00'])
      if (!txt.includes(w)) throw new Error('missing ' + w);
    await c.close();
  });
  await t('and the invoice made from it shows no $0.00 either', async () => {
    const link = await pg.evaluate(async i => {
      const e = Store.estimate(i);
      Store.convertEstimate(e, { customerId: e.customerId, scheduledDate: todayStr(), window:'Anytime', priority:'Normal' });
      const j = Store.data.jobs.find(x => x.estimateId === i);
      j.status = 'complete'; j.laborHours = 0; Store.setPayment(j, { status:'invoiced' });
      return invoiceLinkUrl(await Cloud.publishInvoiceLink(j));
    }, e2);
    const c = await b.newPage({ viewport:{width:390,height:844} });
    c.on('pageerror', e => errs.push('INVOICE PAGEERROR: '+e.message));
    await c.goto(link); await c.waitForTimeout(1200);
    // innerText: what she sees, not the page's own script source
    const txt = await c.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
    if (!/Shut off and drain/.test(txt)) throw new Error('invoice did not render: ' + txt.slice(0,200));
    if (/\$0\.00/.test(txt.replace(/(Received|Balance|due|Paid)[^$]*\$0\.00/gi, ''))) throw new Error('$0.00 on the invoice: ' + txt.slice(txt.indexOf('SOFTENER'), txt.indexOf('SOFTENER') + 500));
    await c.close();
  });

  console.log('--- which mailbox ---');
  await t('left alone, Email still hands the message to the phone\'s mail app', async () => {
    const h = await pg.evaluate(() => { const a = document.createElement('a');
      setMailLink(a, 'pat@example.com', 'Your estimate', 'Hi Pat'); return { href: a.href, target: a.target }; });
    if (!/^mailto:pat%40example\.com\?subject=Your%20estimate&body=Hi%20Pat$/.test(h.href)) throw new Error(h.href);
    if (h.target) throw new Error('target set: '+h.target);
  });
  await t('with Gmail chosen, it opens a Gmail message from the business address', async () => {
    await pg.evaluate(() => { closeModal(); go('data'); }); await pg.waitForTimeout(400);
    await pg.selectOption('#set-mailvia', 'gmail');
    await pg.click('[data-action="save-settings"]'); await pg.waitForTimeout(300);
    const h = await pg.evaluate(() => { const a = document.createElement('a');
      setMailLink(a, 'pat@example.com', 'Your estimate', 'Hi Pat — 2 lines'); return { href: a.href, target: a.target, via: Store.data.settings.mailVia }; });
    if (h.via !== 'gmail') throw new Error('setting not saved: '+h.via);
    const u = new URL(h.href);
    if (u.host !== 'mail.google.com') throw new Error(h.href);
    const p = u.searchParams;
    if (p.get('authuser') !== 'office@example.com' || p.get('view') !== 'cm' || p.get('to') !== 'pat@example.com'
        || p.get('su') !== 'Your estimate' || p.get('body') !== 'Hi Pat — 2 lines') throw new Error(h.href);
    if (/\+/.test(u.search)) throw new Error('spaces written as + : '+u.search);
    if (h.target !== '_blank') throw new Error('target '+h.target);
  });

  /* On an iPhone the web link opened the Gmail app on the inbox, with the
     message gone. There it uses the app's own compose link. */
  await t('on an iPhone, Gmail opens a new message in the Gmail app, filled in', async () => {
    const ip = await b.newPage({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    await ip.goto(APP); await ip.waitForTimeout(400);
    const h = await ip.evaluate(() => { Store.data.settings.mailVia = 'gmail'; Store.data.settings.email = 'office@example.com';
      const a = document.createElement('a'); setMailLink(a, 'pat@example.com', 'Booked for tomorrow', 'Hi Pat — see you at 8.');
      return { href: a.getAttribute('href'), target: a.target }; });
    if (!h.href.startsWith('googlegmail:///co?')) throw new Error(h.href);
    const q = new URLSearchParams(h.href.split('?')[1]);
    if (q.get('to') !== 'pat@example.com' || q.get('subject') !== 'Booked for tomorrow' || q.get('body') !== 'Hi Pat — see you at 8.')
      throw new Error(h.href);
    if (h.target) throw new Error('target '+h.target);
    await ip.close();
  });

  await b.close();
  try { fs.unlinkSync(PAGE); } catch(_){}
  const hard = errs.filter(e=>e.includes('CONSOLE')||e.includes('PAGEERROR'));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
