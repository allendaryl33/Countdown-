/* Two ways to do the same job, one estimate.

   She is weighing a patch against replacing the lot. He wants both prices
   in front of her, she picks one, and the one she picks is the job. The
   danger in that is not the arithmetic — it is which scope her name ends up
   against, and whether the app is sure about it when it has no right to be.

   Three things here have teeth:

   - The estimate's own lines go empty when options are in use, and
     jobFromApproved used to read exactly those lines to decide whether to
     build a job. Approving would have produced no job at all, silently.
   - Nothing picks an option for her. Not the signing sheet, not the
     approved-by-phone button. A default would be a confident guess at the
     scope somebody is putting their name to.
   - What she signs is frozen per option. Signing the dearer one must not
     leave an approval holding the cheaper price.                            */

const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP='http://127.0.0.1:54321/index.html', URL_='http://127.0.0.1:54321', KEY='sb_publishable_test';
const errs=[];

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  await fetch(URL_+'/__reset');

  const pg = await b.newPage({ viewport:{width:1280,height:1100} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text())});
  await pg.goto(APP); await pg.waitForTimeout(400);
  await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'T'}; Cloud.saveCfg();
    return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY]);
  await pg.waitForTimeout(900);

  /* One estimate with three lines on it, the way he would have typed it
     before it occurred to him to quote it a second way. */
  const eid = await pg.evaluate(() => {
    Object.assign(Store.data.settings, { gst:'123456789 RT0001', gstRate:5 });
    const e = Store.data.estimates.find(x => (x.items||[]).length) || Store.data.estimates[0];
    e.status = 'draft'; delete e.approval; e.jobId = null; e.chosen = null; delete e.options;
    e.flatPrice = null;
    e.items = [
      { desc:'Patch the copper at the joint', kind:'labour', qty:2, price:145 },
      { desc:'Fittings',                      kind:'part',   qty:1, price:60 },
      { desc:'Drywall patch',                 kind:'part',   qty:1, price:50 }
    ];
    Store.save();
    return e.id;
  });
  const est   = () => pg.evaluate(i => Store.estimate(i), eid);
  const open  = async () => { await pg.evaluate(i => { closeModal(); openEstimate(i); }, eid); await pg.waitForTimeout(400); };
  const panel = () => pg.evaluate(() => (document.querySelector('#modal-root')||{}).innerText || '');

  console.log('--- before there are any options, nothing has changed ---');

  await t('an estimate with no options prices exactly as it always did', async () => {
    const r = await pg.evaluate(i => {
      const e = Store.estimate(i);
      return { total: Store.estimateTotal(e), money: Store.estimateMoney(e),
               range: Store.estimateRange(e), opts: Store.estOptions(e),
               bucketIsTheEstimate: Store.estBucket(e) === e };
    }, eid);
    if (r.total !== 400) throw new Error('total is ' + r.total);
    if (r.range !== null) throw new Error('it invented a range: ' + JSON.stringify(r.range));
    if (!/^\$400/.test(r.money)) throw new Error('money reads ' + r.money);
    if (r.opts !== null) throw new Error('it thinks it has options');
    if (!r.bucketIsTheEstimate) throw new Error('lines are not being edited on the estimate');
  });

  console.log('--- the button ---');

  await t('+ Option carries his existing lines onto Option 1 and says how many moved', async () => {
    await open();
    if (!await pg.$(`[data-opt-add="${eid}"]`)) throw new Error('there is no + Option button');
    await pg.click(`[data-opt-add="${eid}"]`); await pg.waitForTimeout(500);
    const e = await est();
    if (!e.options || e.options.length !== 1) throw new Error('options: ' + JSON.stringify(e.options));
    if (e.options[0].items.length !== 3)
      throw new Error('his three lines did not come with it: ' + e.options[0].items.length);
    if ((e.items || []).length) throw new Error('the lines were copied, not moved — now there are two sets');
    const log = (e.log||[]).map(l=>l.text).join(' | ');
    if (!/3 lines moved onto Option 1/.test(log)) throw new Error('the log does not say what moved: ' + log);
  });

  await t('and the money is still the same money — moving them changed no price', async () => {
    const r = await pg.evaluate(i => {
      const e = Store.estimate(i);
      return { total: Store.estimateTotal(e), opt: Store.estimateTotal(Store.estAsOption(e, e.options[0])) };
    }, eid);
    if (r.opt !== 400) throw new Error("Option 1 comes to " + r.opt);
    if (r.total !== 400) throw new Error('the estimate comes to ' + r.total);
  });

  await t('a second option starts empty and leaves the first one alone', async () => {
    await open();
    await pg.click(`[data-opt-add="${eid}"]`); await pg.waitForTimeout(500);
    const e = await est();
    if (e.options.length !== 2) throw new Error('options: ' + e.options.length);
    if (e.options[1].items.length !== 0) throw new Error('the new one came with lines on it');
    if (e.options[0].items.length !== 3) throw new Error('it took the first option apart');
    if (e.optOpen !== e.options[1].optId) throw new Error('the editor is not pointed at the new one');
  });

  await t('typing a line writes it onto the option he is editing, not the estimate', async () => {
    await open();
    await pg.fill('#line-desc', 'Replace the stack, wall to wall');
    await pg.fill('#line-price', '9400');
    await pg.click(`[data-add-line="${eid}"]`); await pg.waitForTimeout(500);
    const e = await est();
    if ((e.items || []).length) throw new Error('it landed on the estimate itself');
    if (e.options[0].items.length !== 3) throw new Error('it landed on Option 1');
    if (e.options[1].items.length !== 1) throw new Error('Option 2 has ' + e.options[1].items.length);
    const log = (e.log||[]).map(l=>l.text).join(' | ');
    if (!/Line added: Replace the stack.*\(Option 2\)/.test(log))
      throw new Error('the log does not say which option: ' + log);
  });

  await t('switching back edits the other one, and the totals stay apart', async () => {
    const o1 = await pg.evaluate(i => Store.estimate(i).options[0].optId, eid);
    await open();
    await pg.click(`[data-opt-open="${eid}:${o1}"]`); await pg.waitForTimeout(450);
    await pg.fill('#line-desc', 'Extra hour on site');
    await pg.fill('#line-price', '145');
    await pg.click(`[data-add-line="${eid}"]`); await pg.waitForTimeout(500);
    const r = await pg.evaluate(i => {
      const e = Store.estimate(i);
      return { a: Store.estimateTotal(Store.estAsOption(e, e.options[0])),
               b: Store.estimateTotal(Store.estAsOption(e, e.options[1])),
               n: [e.options[0].items.length, e.options[1].items.length] };
    }, eid);
    if (r.a !== 545) throw new Error('Option 1 comes to ' + r.a);
    if (r.b !== 9400) throw new Error('Option 2 comes to ' + r.b);
    if (r.n[0] !== 4 || r.n[1] !== 1) throw new Error('lines ended up: ' + r.n.join('/'));
  });

  console.log('--- two prices, and no pretending there is one ---');

  await t('the screens show the spread, never one of them on its own', async () => {
    const r = await pg.evaluate(i => {
      const e = Store.estimate(i);
      return { money: Store.estimateMoney(e), range: Store.estimateRange(e) };
    }, eid);
    if (!r.range || r.range.n !== 2) throw new Error('no range: ' + JSON.stringify(r.range));
    if (r.range.lo !== 545 || r.range.hi !== 9400) throw new Error('range is ' + JSON.stringify(r.range));
    if (!/545/.test(r.money) || !/9,400/.test(r.money))
      throw new Error('one number is standing in for two: ' + r.money);
  });

  await t('and the estimates list shows it that way too, not a single figure', async () => {
    await pg.evaluate(() => { closeModal(); go('estimates'); render(); });
    await pg.waitForTimeout(500);
    const txt = await pg.evaluate(() => (document.querySelector('#view')||{}).innerText || '');
    if (!/\$545(\.00)?–\$9,400/.test(txt.replace(/\s/g,''))
        && !/545[\s\S]{0,12}9,400/.test(txt))
      throw new Error('the row does not show both: ' + txt.slice(0,400));
  });

  await t('renaming one is his wording, and it is written down', async () => {
    const o2 = await pg.evaluate(i => Store.estimate(i).options[1].optId, eid);
    await open();
    await pg.fill(`[data-opt-label="${eid}:${o2}"]`, 'Replace it all');
    await pg.evaluate(([i,o]) => document.querySelector(`[data-opt-label="${i}:${o}"]`)
      .dispatchEvent(new Event('change',{bubbles:true})), [eid,o2]);
    await pg.waitForTimeout(400);
    const e = await est();
    if (e.options[1].label !== 'Replace it all') throw new Error('label is ' + e.options[1].label);
    const log = (e.log||[]).map(l=>l.text).join(' | ');
    if (!/Option 2 renamed to Replace it all/.test(log)) throw new Error('not in the log: ' + log);
  });

  console.log('--- sending it ---');

  let links = null;
  await t('one signing link per option, each with its own price frozen on it', async () => {
    await open();
    await pg.click(`[data-link-estimate="${eid}"]`); await pg.waitForTimeout(1400);
    const rows = await fetch(URL_+'/__state').then(r=>r.json()).catch(()=>null);
    const got = await pg.evaluate(async () => {
      await Cloud.pullSignLinks();
      return (Cloud.signLinks||[]).length;
    });
    const e = await est();
    const toks = e.options.map(o => (o.tokens||[]).slice(-1)[0]);
    if (toks.some(x => !x)) throw new Error('an option got no token: ' + JSON.stringify(toks));
    if (toks[0] === toks[1]) throw new Error('both options share one token — then signing means nothing');
    links = toks;
    if (got < 2) throw new Error('only ' + got + ' link(s) went up');
  });

  await t('the message carries both options, both prices and both links', async () => {
    const note = await pg.inputValue('#lk-note');
    const urls = note.match(/https?:\/\/\S+/g) || [];
    if (urls.length !== 2) throw new Error(urls.length + ' link(s) in it: ' + note);
    /* GST is on for this shop, so what she is quoted is the gross — the
       same figure the signing page will show her. A message quoting 545
       beside a page saying 572.25 is the kind of small mismatch that gets
       argued about on a doorstep. */
    if (!/572\.25/.test(note)) throw new Error('Option 1 price missing or pre-tax: ' + note);
    if (!/9,870/.test(note)) throw new Error('Option 2 price missing or pre-tax: ' + note);
    if (!/Replace it all/.test(note)) throw new Error('his own wording did not travel: ' + note);
    if (!/clos/i.test(note)) throw new Error('nothing tells her approving one closes the other: ' + note);
    if (urls[0] === urls[1]) throw new Error('the same link twice');
  });

  await t("Copy hands over the whole message, not the first link on its own", async () => {
    const b = await pg.evaluate(() => {
      const n = document.querySelector('[data-copy-link][data-sent-id]');
      return n ? { note: !!n.dataset.copyNote, label: n.innerText } : null;
    });
    if (!b) throw new Error('no copy button');
    if (!b.note) throw new Error('it would copy one link and lose the other price');
    if (!/message/i.test(b.label)) throw new Error('it still calls itself a link: ' + b.label);
  });

  await t("each link's own payload holds only its own scope and its own total", async () => {
    const rows = await fetch(URL_+'/__links').then(r=>r.json()).catch(()=>null);
    if (!rows) { console.log('       (the mock does not expose rows; checked via the app instead)');
      return; }
    const mine = rows.filter(r => links.includes(r.token));
    if (mine.length !== 2) throw new Error('found ' + mine.length + ' rows');
    const totals = mine.map(r => r.payload.total).sort((a,b)=>a-b);
    if (Math.round(totals[0]) !== 572 || Math.round(totals[1]) !== 9870)
      throw new Error('payload totals: ' + JSON.stringify(totals));
    if (!mine.every(r => (r.payload.options||[]).length === 2))
      throw new Error('a payload cannot show her the other option');
  });

  console.log('--- she signs one ---');

  await t('signing the dearer one approves that one and declines the other', async () => {
    const png = 'data:image/png;base64,' + 'A'.repeat(400);
    const r = await fetch(URL_+'/rest/v1/rpc/sign_estimate', {
      method:'POST', headers:{ 'apikey':KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({ p_token: links[1], p_name:'Chelsea Ward', p_role:'Homeowner', p_signature:png })
    }).then(x=>x.json());
    if (!r || !r.ok) throw new Error('the signature did not go in: ' + JSON.stringify(r));
    await pg.evaluate(() => Cloud.pullSignLinks()); await pg.waitForTimeout(900);
    const e = await est();
    if (!e.approval) throw new Error('it never came back');
    if (e.chosen !== e.options[1].optId) throw new Error('it recorded the wrong option as chosen');
    if (!e.options[0].declinedAt) throw new Error('Option 1 is still live after she signed the other');
    if (e.options[1].declinedAt) throw new Error('it declined the one she signed');
  });

  await t('the approval holds the price she actually agreed to, not the cheaper one', async () => {
    const e = await est();
    if (e.approval.total !== 9400)
      throw new Error('frozen at ' + e.approval.total + ' — she signed for 9400');
    if (!/Replace it all/.test(e.approval.option || ''))
      throw new Error('the approval does not name the option: ' + e.approval.option);
    if ((e.approval.items||[]).length !== 1)
      throw new Error('it froze the wrong lines: ' + JSON.stringify(e.approval.items));
  });

  await t('and the log says the other one is done, because the page promised her that', async () => {
    const e = await est();
    const log = (e.log||[]).map(l=>l.text).join(' | ');
    if (!/Option 1 declined/.test(log)) throw new Error('nothing in the log about it: ' + log);
  });

  /* The one that would have failed in silence. */
  await t('the job is built from the option she chose — not from nothing', async () => {
    const e = await est();
    if (!e.jobId) throw new Error('approved, and no job was made at all');
    const j = await pg.evaluate(id => Store.job(id), e.jobId);
    if (!j) throw new Error('jobId points at nothing');
    if (j.quotedTotal !== 9400) throw new Error('the job was quoted at ' + j.quotedTotal);
    if ((j.parts||[]).length !== 1)
      throw new Error('the job got ' + (j.parts||[]).length + " lines — Option 1's, or none");
    if (!/Replace the stack/.test(((j.parts||[])[0]||{}).desc || ''))
      throw new Error('wrong lines on the job: ' + JSON.stringify(j.parts));
    if (!/Replace it all/.test((j.log||[]).map(l=>l.text).join(' ')))
      throw new Error('the job does not say which option it came from');
  });

  await t('drift is measured against the option she signed', async () => {
    const r = await pg.evaluate(i => {
      const e = Store.estimate(i);
      const o = Store.estChosen(e);
      o.items[0].price = 9600; Store.save();
      const d = Store.approvalDrift(e);
      o.items[0].price = 9400; Store.save();
      return d;
    }, eid);
    if (r !== 200) throw new Error('drift came out at ' + r + ', so it compared the wrong option');
  });

  await t('the panel names the option she approved', async () => {
    await open();
    const p = await panel();
    if (!/Approved by Chelsea Ward/.test(p)) throw new Error('no approval on screen');
    if (!/Replace it all/.test(p)) throw new Error('it does not say which one: ' + p.slice(0,400));
  });

  await t('the printed estimate shows only what she signed for', async () => {
    const doc = await pg.evaluate(i => estimateDocHtml(Store.estimate(i)), eid);
    if (!/Replace the stack/.test(doc)) throw new Error("the signed option's work is missing");
    if (/Patch the copper/.test(doc))
      throw new Error('it still prints the option she turned down as though it were on offer');
  });

  console.log('--- nothing is ever picked for her ---');

  let e2 = null;
  await t('the signing sheet offers no default, and no way to approve until he taps one', async () => {
    e2 = await pg.evaluate(() => {
      const e = { id: uid('est'), no: 9001, createdAt: Date.now(), status:'draft',
        type:'Other', service:'', description:'Two ways', validDays:30,
        customerId: Store.data.customers[0].id, items:[], flatPrice:null,
        materials:[], timeEntries:[], photos:[], log:[], visitDate:null,
        window:'Anytime', techId:null, scopeOf:null, options:[], chosen:null };
      Store.data.estimates.push(e);
      const a = Store.addEstOption(e); a.items=[{desc:'Patch it',kind:'labour',qty:1,price:400}];
      const c = Store.addEstOption(e); c.items=[{desc:'Replace it',kind:'labour',qty:1,price:8000}];
      Store.save(); return e.id;
    });
    await pg.evaluate(i => { closeModal(); openEstimateSign(i); }, e2); await pg.waitForTimeout(500);
    const r = await pg.evaluate(() => ({
      picks: document.querySelectorAll('[data-sign-opt]').length,
      armed: !!document.querySelector('[data-save-est-sign]'),
      txt:   (document.querySelector('#modal-root')||{}).innerText || ''
    }));
    if (r.picks !== 2) throw new Error('it offers ' + r.picks + ' option(s) to pick');
    if (r.armed) throw new Error('Approve & sign is live before anyone said which option');
    if (!/Nothing is chosen until you do/.test(r.txt))
      throw new Error('it does not say that nothing is chosen yet: ' + r.txt.slice(0,300));
  });

  await t('once he taps one, that one is what is on screen to be agreed to', async () => {
    const oid = await pg.evaluate(i => Store.estimate(i).options[1].optId, e2);
    await pg.click(`[data-sign-opt="${e2}:${oid}"]`); await pg.waitForTimeout(500);
    const r = await pg.evaluate(() => ({
      armed: !!document.querySelector('[data-save-est-sign]'),
      txt:   (document.querySelector('#modal-root')||{}).innerText || ''
    }));
    if (!r.armed) throw new Error('still no way to approve it');
    if (!/Replace it/.test(r.txt)) throw new Error("the picked option's work is not shown: " + r.txt.slice(0,300));
    if (/Patch it/.test(r.txt)) throw new Error('it is showing both scopes as one agreement');
  });

  await t('signing it there records that option, and declines the other', async () => {
    await pg.evaluate(() => {
      const cv = document.querySelector('#sigpad');
      SigPad.dirty = true;
      const ctx = cv.getContext('2d'); ctx.fillRect(2,2,30,8);
    });
    await pg.fill('#es-name', 'Chelsea Ward');
    await pg.click(`[data-save-est-sign="${e2}"]`); await pg.waitForTimeout(700);
    const e = await pg.evaluate(i => Store.estimate(i), e2);
    if (!e.approval) throw new Error('nothing was recorded');
    if (e.approval.total !== 8000) throw new Error('frozen at ' + e.approval.total);
    if (!e.options[0].declinedAt) throw new Error('the other one is still live');
    if (!e.jobId) throw new Error('no job came out of it');
  });

  await t('approving by phone asks which one instead of guessing', async () => {
    const e3 = await pg.evaluate(() => {
      const e = { id: uid('est'), no: 9002, createdAt: Date.now(), status:'sent',
        type:'Other', service:'', description:'Two ways', validDays:30,
        customerId: Store.data.customers[0].id, items:[], flatPrice:null,
        materials:[], timeEntries:[], photos:[], log:[], visitDate:null,
        window:'Anytime', techId:null, scopeOf:null, options:[], chosen:null };
      Store.data.estimates.push(e);
      const a = Store.addEstOption(e); a.items=[{desc:'Patch it',kind:'labour',qty:1,price:400}];
      const c = Store.addEstOption(e); c.items=[{desc:'Replace it',kind:'labour',qty:1,price:8000}];
      Store.save(); return e.id;
    });
    await pg.evaluate(i => { closeModal(); openEstimate(i); }, e3); await pg.waitForTimeout(400);
    await pg.click(`[data-est-status="${e3}:approved"]`); await pg.waitForTimeout(500);
    let r = await pg.evaluate(i => ({
      asked: (document.querySelector('#modal-root')||{}).innerText || '',
      status: Store.estimate(i).status, job: !!Store.estimate(i).jobId
    }), e3);
    if (!/Which one did they go for/.test(r.asked))
      throw new Error('it did not ask: ' + r.asked.slice(0,250));
    if (r.status === 'approved') throw new Error('it marked it approved without knowing which');
    if (r.job) throw new Error('it built a job before anyone said which option');

    const oid = await pg.evaluate(i => Store.estimate(i).options[0].optId, e3);
    await pg.click(`[data-est-pick="${e3}:${oid}"]`); await pg.waitForTimeout(700);
    r = await pg.evaluate(i => {
      const e = Store.estimate(i);
      return { status: e.status, chosen: e.chosen === e.options[0].optId,
               gone: !!e.options[1].declinedAt,
               quoted: e.jobId ? Store.job(e.jobId).quotedTotal : null };
    }, e3);
    if (r.status !== 'approved') throw new Error('status is ' + r.status);
    if (!r.chosen) throw new Error('it chose a different one than he tapped');
    if (!r.gone) throw new Error('the other is still live');
    if (r.quoted !== 400) throw new Error('the job was quoted at ' + r.quoted);
  });

  console.log('--- taking one away ---');

  await t('an option whose link is already out cannot be quietly removed', async () => {
    const r = await pg.evaluate(i => {
      const e = Store.estimate(i);
      return { why: Store.canDropOption(e, e.options[0]) };
    }, eid);
    if (!r.why) throw new Error('it would let him drop an option a customer is holding a link to');
    if (!/out with them|pull it back/i.test(r.why)) throw new Error('unhelpful reason: ' + r.why);
  });

  await t('dropping the last option puts its lines back rather than taking them', async () => {
    const r = await pg.evaluate(() => {
      const e = { id: uid('est'), no: 9003, createdAt: Date.now(), status:'draft',
        type:'Other', service:'', description:'', validDays:30,
        customerId: Store.data.customers[0].id, items:[], flatPrice:null,
        materials:[], timeEntries:[], photos:[], log:[], visitDate:null,
        window:'Anytime', techId:null, scopeOf:null, options:[], chosen:null };
      Store.data.estimates.push(e);
      const a = Store.addEstOption(e);
      a.items = [{desc:'Patch it',kind:'labour',qty:1,price:400}];
      Store.save();
      const stop = Store.dropEstOption(e, a.optId);
      return { stop, items: (e.items||[]).length, total: Store.estimateTotal(e),
               opts: Store.estOptions(e),
               log: (e.log||[]).map(l=>l.text).join(' | ') };
    });
    if (r.stop) throw new Error('it refused: ' + r.stop);
    if (r.items !== 1) throw new Error('his line went with it — ' + r.items + ' left');
    if (r.total !== 400) throw new Error('total is ' + r.total);
    if (r.opts !== null) throw new Error('it is still in options mode');
    if (!/1 line kept/.test(r.log)) throw new Error('the log does not say the line was kept: ' + r.log);
  });

  console.log('--- an old shop opens unchanged ---');

  await t('a shop saved before any of this existed loads and prices the same', async () => {
    const r = await pg.evaluate(() => {
      // An estimate that never had options — which is every one he has
      // written so far. Not one whose lines now live on an option.
      const e = Store.data.estimates.find(x => !x.options && (x.items||[]).length)
             || Store.data.estimates.find(x => !x.options);
      if (!e) throw new Error('every estimate in the shop has options — nothing to check');
      e.items = e.items || [{ desc:'Old line', kind:'labour', qty:1, price:200 }];
      Store.save();
      const before = Store.estimateTotal(e);
      Store.backfill();
      return { before, after: Store.estimateTotal(e),
               options: e.options === undefined ? 'left alone' : JSON.stringify(e.options) };
    });
    if (!r.before) throw new Error('setup: the estimate was worth nothing, so this proves nothing');
    if (r.before !== r.after) throw new Error(r.before + ' became ' + r.after);
    if (r.options !== 'left alone')
      throw new Error('backfill invented an options array: ' + r.options);
  });

  await b.close();
  console.log('\n=== failures: ' + errs.length + ' ===');
  errs.forEach(e => console.log('  - ' + e));
  if (errs.length) process.exit(1);
  console.log('all good');
})();
