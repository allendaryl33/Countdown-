/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1400,height:1000} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  let estId;

  console.log('--- typing a list at the kitchen table ---');
  await t('six parts go in without the cursor ever leaving the box', async () => {
    estId = await pg.evaluate(() => Store.data.estimates[0].id);
    await pg.evaluate(id => openEstimate(id), estId); await pg.waitForTimeout(400);
    const parts = ['ZZTEST expansion tank','ZZTEST sharkbite 3/4','ZZTEST braided supply',
                   'ZZTEST wax ring','ZZTEST angle stop','ZZTEST pex coil'];
    await pg.click('#mat-text-estimate');
    for (const p of parts){
      await pg.keyboard.type(p);
      await pg.keyboard.press('Enter');
      await pg.waitForTimeout(90);
      const focus = await pg.evaluate(() => document.activeElement.id);
      if (focus !== 'mat-text-estimate') throw new Error('focus left after "'+p+'": '+focus);
    }
    const n = await pg.evaluate(id => Store.materialsOf(Store.estimate(id)).length, estId);
    if (n !== 6) throw new Error('stored '+n);
    console.log('       6 in, focus never left');
  });

  await t('a quantity sticks to its item', async () => {
    await pg.fill('#mat-text-estimate', 'ZZQTY pipe strap');
    await pg.fill('#mat-qty-estimate', '12');
    await pg.keyboard.press('Enter'); await pg.waitForTimeout(200);
    const m = await pg.evaluate(id => Store.materialsOf(Store.estimate(id)).find(x => x.text === 'ZZQTY pipe strap'), estId);
    if (!m) throw new Error('Enter in the quantity box did not add the item');
    if (m.qty !== 12) throw new Error('qty stored as ' + m.qty);
    const q = await pg.evaluate(() => document.querySelector('#mat-qty-estimate').value);
    if (q !== '1') throw new Error('qty did not reset, next item would inherit 12');
    console.log('       12x, qty box back to 1');
  });

  await t('an empty box does not add a blank row', async () => {
    const before = await pg.evaluate(id => Store.materialsOf(Store.estimate(id)).length, estId);
    await pg.click('#mat-text-estimate');
    await pg.keyboard.press('Enter'); await pg.waitForTimeout(150);
    const after = await pg.evaluate(id => Store.materialsOf(Store.estimate(id)).length, estId);
    if (after !== before) throw new Error('added an empty one');
  });

  console.log('--- the customer never sees it ---');
  await t('nothing reaches the printed estimate', async () => {
    await pg.evaluate(id => printEstimate(Store.estimate(id)), estId);
    await pg.waitForTimeout(300);
    const doc = await pg.evaluate(() => document.querySelector('#print-area').textContent);
    for (const bad of ['ZZTEST','ZZQTY','still to pick up','your list, not the customer']){
      if (doc.includes(bad)) throw new Error('"'+bad+'" printed on the customer copy');
    }
    console.log('       7 private items, none on the customer document');
  });

  console.log('--- it follows the work ---');
  let jobId;
  await t('converting to a job brings the list with it', async () => {
    jobId = await pg.evaluate(id => {
      const e = Store.estimate(id);
      const j = Store.convertEstimate(e, { customerId: Store.data.customers[0].id,
        scheduledDate: todayStr(), window:'Anytime', priority:'Normal' });
      return j.id;
    }, estId);
    const r = await pg.evaluate(id => {
      const j = Store.job(id);
      return { n: Store.materialsOf(j).length, left: Store.stillNeeded(j),
               tagged: Store.materialsOf(j).every(m => m.from === 'estimate'),
               distinctIds: new Set(Store.materialsOf(j).map(m => m.id)).size };
    }, jobId);
    if (r.n !== 7) throw new Error('job has '+r.n);
    if (!r.tagged) throw new Error('not marked as carried from the quote');
    if (r.distinctIds !== 7) throw new Error('ids collided on copy');
    console.log('       all 7 carried, marked "quoted", fresh ids');
  });

  await t('ticking one off on the job does not touch the estimate', async () => {
    const mid = await pg.evaluate(id => Store.materialsOf(Store.job(id))[0].id, jobId);
    await pg.evaluate(([j,m]) => Store.setMaterial('job', j, m, { got:true }), [jobId, mid]);
    const r = await pg.evaluate(([j,e]) => ({
      job: Store.stillNeeded(Store.job(j)), est: Store.stillNeeded(Store.estimate(e)) }), [jobId, estId]);
    if (r.job !== 6) throw new Error('job outstanding ' + JSON.stringify(r));
    if (r.est !== 7) throw new Error('estimate changed too: ' + JSON.stringify(r));
    console.log('       job 6 left, estimate untouched at 7');
  });

  await t('more can be added once you are actually there', async () => {
    await pg.evaluate(id => { Store.addMaterial('job', id, 'Second trip: 1in brass nipple', 2); }, jobId);
    const r = await pg.evaluate(id => {
      const l = Store.materialsOf(Store.job(id));
      return { n: l.length, src: l[l.length-1].from };
    }, jobId);
    if (r.n !== 8) throw new Error('n='+r.n);
    if (r.src !== 'job') throw new Error('mis-tagged as '+r.src);
  });

  console.log('--- standing in the aisle ---');
  await t('one list gathers every outstanding item across jobs', async () => {
    await pg.evaluate(() => {
      closeModal();
      const other = Store.data.jobs.find(j => isOpen(j) && !Store.materialsOf(j).length);
      Store.addMaterial('job', other.id, 'ZZTEST boiler circulator', 1);
      go('pickup');
    });
    await pg.waitForTimeout(400);
    const r = await pg.evaluate(() => ({
      groups: document.querySelectorAll('.pick-group').length,
      items: document.querySelectorAll('.pick-group .mat-list li').length,
      note: (document.querySelector('.filter-note')||{}).textContent.replace(/\s+/g,' ').trim()
    }));
    if (r.groups < 2) throw new Error('only '+r.groups+' job(s) listed');
    if (r.items !== 8) throw new Error('showing '+r.items+' items, expected 8 outstanding');
    console.log('       ' + r.note);
  });

  await t('ticked items drop off the list', async () => {
    await pg.click('.pick-group .mat-list li .mat-tick'); await pg.waitForTimeout(400);
    const n = await pg.evaluate(() => document.querySelectorAll('.pick-group .mat-list li').length);
    if (n !== 7) throw new Error('still showing '+n);
    console.log('       8 -> 7');
  });

  await t('costs entered here total up and can become the job parts cost', async () => {
    await pg.evaluate(id => {
      const l = Store.materialsOf(Store.job(id));
      Store.setMaterial('job', id, l[0].id, { cost: 68 });
      Store.setMaterial('job', id, l[1].id, { cost: 12.5 });
      closeModal(); openJob(id);
    }, jobId);
    await pg.waitForTimeout(400);
    const sum = await pg.evaluate(() => (document.querySelector('.mat-cost')||{}).textContent || '');
    if (!/\$/.test(sum)) throw new Error('no total shown: '+sum);
    await pg.click('[data-mat-usecost]'); await pg.waitForTimeout(400);
    const mc = await pg.evaluate(id => Store.job(id).materialCost, jobId);
    if (!mc) throw new Error('parts cost not applied');
    console.log('       totalled and pushed into the parts-cost box as ' + mc);
  });

  await t('Today warns before you drive off', async () => {
    await pg.evaluate(() => { closeModal(); go('today'); }); await pg.waitForTimeout(400);
    const txt = await pg.evaluate(() => document.querySelector('#view').textContent);
    if (!/still to pick up for this one/.test(txt)) throw new Error('no flag on the stop card');
    console.log('       flagged on the stop');
  });

  await t('an empty pick-up list says what it is for', async () => {
    await pg.evaluate(() => {
      Store.data.jobs.forEach(j => j.materials = []);
      Store.data.estimates.forEach(e => e.materials = []);
      Store.save(); go('pickup');
    });
    await pg.waitForTimeout(350);
    const txt = await pg.evaluate(() => document.querySelector('#view').textContent);
    if (!/one trip covers every job/.test(txt)) throw new Error('no guidance in the empty state');
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
