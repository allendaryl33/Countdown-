/* What a line is tagged as, and what that tag must never do on its own.

   The tags were Labor / Part / Flat rate. Flat rate never belonged there — a
   flat price is set on the option or the job, not on a line of it — and he
   wanted that slot to be Sub instead, so his own records can tell a
   subcontractor's tile work from his labour.

   The trap is that "Flat rate" is not an unused slot. Ten price-book entries
   carry it and every one of them is his own fixed-price work: sewer camera,
   backflow test, boiler service, haul-away. Renaming the label to Sub would
   have marked all ten as subcontracted, in the records he is building the tag
   for, without a word. So the tag is retired rather than renamed: offered
   nowhere new, shown wherever it is already set, and nothing moves.

   Nov 9 he settled it the other way round from renaming: Flat rate stays,
   on offer again, AND Sub sits beside it. A flat-rate line is one amount
   (he sells a flat $350 camera job; quantity x hourly made it read hourly).
   So the pick list has four, the ten keep their tag under its own name, and
   the guard against any of them reading as Sub is unchanged.

   These tests are mostly about that: the things that must NOT have happened. */

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

  const eid = await pg.evaluate(() => {
    const e = Store.data.estimates.find(x => (x.items||[]).length) || Store.data.estimates[0];
    e.status='draft'; delete e.approval; e.jobId=null; e.chosen=null; delete e.options;
    e.flatPrice=null;
    e.items = [
      { desc:'Rough-in and connect',  kind:'labor', qty:4, price:145 },
      { desc:'Mixing valve',          kind:'part',  qty:1, price:165 },
      { desc:'Service call',          kind:'flat',  qty:1, price:145 }   // a tag he already has
    ];
    Store.save(); return e.id;
  });
  const est  = () => pg.evaluate(i => Store.estimate(i), eid);
  const open = async () => { await pg.evaluate(i => { closeModal(); openEstimate(i); }, eid); await pg.waitForTimeout(400); };
  const opts = sel => pg.evaluate(s => [...document.querySelectorAll(s + ' option')]
    .map(o => o.value + '=' + o.textContent.trim()), sel);

  console.log('--- what the dropdown offers ---');

  await t('the pick list is Labor, Material / Parts, Sub and Flat rate — Sub beside it, not instead of it', async () => {
    await open();
    const o = await opts('#line-kind');
    const ids = o.map(x => x.split('=')[0]);
    // Text (no price) joined the list Nov 10, for section titles and steps.
    if (ids.join(',') !== 'labor,part,sub,flat,text')
      throw new Error('the list is: ' + o.join(' | '));
    if (!/Material \/ Parts/.test(o.join(' '))) throw new Error('Part was not relabelled: ' + o.join(' | '));
    if (!/sub=Sub/.test(o.join(' '))) throw new Error('Sub is not there: ' + o.join(' | '));
    if (!/flat=Flat rate/.test(o.join(' '))) throw new Error('Flat rate is not on offer: ' + o.join(' | '));
  });

  await t('a line he already tagged Flat rate still shows its own tag, selected', async () => {
    const o = await opts(`[data-line-edit="${eid}:2:kind"]`);
    const sel = await pg.evaluate(([i]) => document.querySelector(`[data-line-edit="${i}:2:kind"]`).value, [eid]);
    if (sel !== 'flat')
      throw new Error('the select shows ' + sel + ' for a line tagged flat — it would re-tag on save');
    if (!/flat=Flat rate/.test(o.join(' ')))
      throw new Error('the tag does not show under its own name: ' + o.join(' | '));
  });

  /* The whole point. A select that cannot show the current value re-tags the
     line the moment anything else on that row is saved. */
  await t('and editing something else on that row does not re-tag it', async () => {
    await pg.fill(`[data-line-edit="${eid}:2:price"]`, '155');
    await pg.evaluate(([i]) => document.querySelector(`[data-line-edit="${i}:2:price"]`)
      .dispatchEvent(new Event('change',{bubbles:true})), [eid]);
    await pg.waitForTimeout(400);
    const it = (await est()).items[2];
    if (it.price !== 155) throw new Error('the price did not save: ' + it.price);
    if (it.kind !== 'flat') throw new Error('it came out tagged ' + it.kind + ' — his record was rewritten');
  });

  await t('tagging a line Sub stores sub, and says so when reopened', async () => {
    await open();
    await pg.selectOption(`[data-line-edit="${eid}:1:kind"]`, 'sub');
    await pg.waitForTimeout(400);
    if ((await est()).items[1].kind !== 'sub')
      throw new Error('stored as ' + (await est()).items[1].kind);
    await open();
    const sel = await pg.evaluate(([i]) => document.querySelector(`[data-line-edit="${i}:1:kind"]`).value, [eid]);
    if (sel !== 'sub') throw new Error('reopened showing ' + sel);
  });

  console.log('--- the ten he already has ---');

  await t('nothing in the price book was relabelled as Sub', async () => {
    const r = await pg.evaluate(() => {
      const by = {};
      Store.data.priceBook.forEach(i => { by[i.kind] = (by[i.kind]||0) + 1; });
      /* Checking the tag he SEES, not just the id underneath. Renaming the
         old tag's label would have left every id alone and still told him
         ten of his own fixed-price jobs were subcontracted — which is the
         whole thing this is guarding against, so testing ids alone would
         have proved nothing. */
      const seen = Store.data.priceBook.map(i => {
        const k = KIND_BY_ID[i.kind];
        return { desc: i.desc, shown: k ? k.label : i.kind };
      });
      return { by,
               subs: seen.filter(x => /sub/i.test(x.shown)).map(x => x.desc),
               fixed: seen.filter(x => /flat rate/i.test(x.shown)).length };
    });
    if (r.subs.length)
      throw new Error('his own work reads as subcontracted: ' + r.subs.join(', '));
    if (!r.by.flat)
      throw new Error('the fixed-price items vanished instead of being left alone: ' + JSON.stringify(r.by));
    if (r.fixed !== r.by.flat)
      throw new Error(r.fixed + ' of ' + r.by.flat + ' show an honest name');
  });

  await t('they are still pickable from the price book dropdown', async () => {
    await open();
    const r = await pg.evaluate(() => {
      const sel = document.querySelector('#pb-pick');
      const groups = [...sel.querySelectorAll('optgroup')].map(g => g.label);
      const flatIds = Store.data.priceBook.filter(i => i.kind === 'flat').map(i => i.id);
      const present = flatIds.filter(id => sel.querySelector(`option[value="${id}"]`));
      return { groups, want: flatIds.length, got: present.length };
    });
    if (r.got !== r.want)
      throw new Error(r.got + ' of his ' + r.want + ' fixed-price items are reachable');
    if (!r.groups.some(g => /Flat rate/.test(g)))
      throw new Error('no heading for them: ' + r.groups.join(' | '));
  });

  /* Setting a select to a value it has no option for leaves it on the first
     one. That would have handed back a Labor line without a word. */
  await t('picking one keeps its tag instead of quietly making it Labor', async () => {
    const id = await pg.evaluate(() => (Store.data.priceBook.find(i => i.kind === 'flat')||{}).id);
    if (!id) throw new Error('no fixed-price item to pick');
    await pg.selectOption('#pb-pick', id); await pg.waitForTimeout(400);
    const got = await pg.evaluate(() => $("#line-kind").value);
    if (got !== 'flat') throw new Error('the form came out tagged ' + got);
    await pg.click(`[data-add-line="${eid}"]`); await pg.waitForTimeout(500);
    const items = (await est()).items;
    const added = items[items.length - 1];
    if (added.kind !== 'flat') throw new Error('the line was added as ' + added.kind);
  });

  await t('the price book page files them under Flat rate, and no longer calls it retired', async () => {
    await pg.evaluate(() => { closeModal(); go('pricebook'); render(); });
    await pg.waitForTimeout(500);
    /* innerText comes back with the headings upper-cased, because the
       section titles are text-transform:uppercase and Chrome reports the
       rendered text. Matching case here is matching a stylesheet. */
    const x = (await pg.evaluate(() => (document.querySelector('#view')||{}).innerText || ''))
      .replace(/\s+/g, ' ');
    if (!/flat rate/i.test(x)) throw new Error('no heading: ' + x.slice(0,400));
    if (/not offered on new lines/i.test(x))
      throw new Error('it still calls the tag retired: ' + x.slice(0,400));
    if (!/material \/ parts/i.test(x)) throw new Error('Part was not relabelled on this page either');
    if (/fixed price/i.test(x)) throw new Error('the retired name is still on the page: ' + x.slice(0,400));
  });

  /* Flat rate is an offered tag again, so like Labor its heading stays when
     empty — the place to file the next one is always there. */
  await t('moving them all off Flat rate leaves its heading, empty, rather than hiding the tag', async () => {
    const x = await pg.evaluate(() => {
      // He re-tags them himself one day; the page should tidy up after him.
      Store.data.priceBook.filter(i => i.kind === 'flat').forEach(i => { i.kind = 'labor'; });
      Store.save(); render();
      return ((document.querySelector('#view')||{}).innerText || '').replace(/\s+/g,' ');
    });
    await pg.waitForTimeout(300);
    if (!/flat rate/i.test(x) || !/nothing saved under flat rate/i.test(x))
      throw new Error('the Flat rate heading went: ' + x.slice(0,400));
  });

  console.log('--- what the tag must not reach ---');

  await t('an hour line still prints its unit; a Sub line does not get one', async () => {
    const doc = await pg.evaluate(i => {
      const e = Store.estimate(i);
      e.items = [{ desc:'On site', kind:'labor', qty:4, price:145 },
                 { desc:'Tile, subcontracted', kind:'sub', qty:1, price:2200 }];
      e.flatPrice = null; Store.save();
      return estimateDocHtml(e);
    }, eid);
    if (!/4 hr/.test(doc)) throw new Error('the labour line lost its hr: ' + doc.slice(0,200));
    const subRow = (doc.match(/Tile, subcontracted[\s\S]{0,160}/) || [''])[0];
    if (/\bhr\b/.test(subRow)) throw new Error('a Sub line printed as hours: ' + subRow);
  });

  /* His actual worry: he has an estimate out for signature right now. */
  await t('a published signing payload carries no tag at all, so a live link cannot shift', async () => {
    const r = await pg.evaluate(async i => {
      const e = Store.estimate(i);
      await Cloud.publishSignLinks(e);
      return null;
    }, eid);
    const rows = await fetch(URL_+'/__links').then(x=>x.json());
    const mine = rows.filter(r => r.estimate_id === eid);
    if (!mine.length) throw new Error('nothing was published, so this proves nothing');
    const keys = new Set();
    mine.forEach(r => (r.payload.items||[]).forEach(it => Object.keys(it).forEach(k => keys.add(k))));
    if (!keys.size) throw new Error('no items in the payload at all');
    if (keys.has('kind'))
      throw new Error('the payload carries a tag, so re-tagging could change what she sees: ' +
                      [...keys].join(','));
    if ([...keys].sort().join(',') !== 'desc,price,qty')
      throw new Error('payload item shape is ' + [...keys].sort().join(','));
  });

  await t('and a frozen approval does not carry one either', async () => {
    const ap = await pg.evaluate(i => {
      const e = Store.estimate(i);
      delete e.approval;
      Store.signEstimate(e, { name:'Test Signer', role:'Homeowner',
        signature:'data:image/png;base64,' + 'A'.repeat(300) });
      return e.approval;
    }, eid);
    if (!ap) throw new Error('nothing was recorded');
    const keys = [...new Set((ap.items||[]).flatMap(i => Object.keys(i)))].sort();
    if (keys.includes('kind')) throw new Error('the approval froze a tag: ' + keys.join(','));
  });

  await t('a tag this version has never heard of still shows itself, rather than being swapped', async () => {
    const r = await pg.evaluate(i => {
      const e = Store.estimate(i);
      delete e.approval; e.status = 'draft';
      e.items = [{ desc:'Something from a later version', kind:'permit', qty:1, price:90 }];
      Store.save(); closeModal(); openEstimate(i);
      const sel = document.querySelector(`[data-line-edit="${i}:0:kind"]`);
      return { value: sel ? sel.value : null,
               labels: sel ? [...sel.options].map(o => o.value) : [] };
    }, eid);
    await pg.waitForTimeout(200);
    if (r.value !== 'permit')
      throw new Error('it shows ' + r.value + ' — saving the row would rewrite his tag');
    if (r.labels.indexOf('permit') === -1)
      throw new Error('the unknown tag is not even an option: ' + r.labels.join(','));
  });

  await b.close();
  console.log('\n=== failures: ' + errs.length + ' ===');
  errs.forEach(e => console.log('  - ' + e));
  if (errs.length) process.exit(1);
  console.log('all good');
})();
