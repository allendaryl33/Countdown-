/* Two small ones from Nov 26.

   A customer record had no way to go. "Test Scratch" was made to try
   things, its jobs and estimates were deleted, and the customer stayed
   with no button to remove it. Now there is one — but only for a customer
   nothing hangs off; one with jobs or estimates says how many instead,
   because deleting it would leave those pointing at nobody.

   And the Estimates list showed the old total behind the estimate window
   while an add-on line was being added, until the window closed. The row
   behind now keeps up.                                                    */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP=`file://${REPO_DIR}/index.html`, errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1280,height:1000} });
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('dialog', d => { errs.push('BROWSER POP-UP: ' + d.message().split('\n')[0]); d.dismiss(); });
  await pg.goto(APP); await pg.waitForTimeout(500);
  await pg.evaluate(()=>localStorage.clear()); await pg.reload(); await pg.waitForTimeout(400);
  const ask = () => pg.evaluate(() => { const r = document.querySelector('#ask-root .ask'); return r ? r.textContent.replace(/\s+/g,' ').trim() : ''; });

  console.log('--- deleting a customer ---');
  const lone = await pg.evaluate(() => {
    const c = { id: uid('cust'), name: 'Sam Scratch', phone: '', email: '', address: '', city: '', notes: '' };
    Store.data.customers.push(c); Store.save(); return c.id;
  });
  await t('a new customer form has no Delete button — there is nothing to delete yet', async () => {
    await pg.evaluate(() => openCustomerForm()); await pg.waitForTimeout(250);
    if (await pg.$('[data-del-customer]')) throw new Error('Delete on an unsaved customer');
    await pg.evaluate(() => closeModal());
  });
  await t('a customer with jobs is not deleted, and it says how many', async () => {
    const busy = await pg.evaluate(() => Store.data.jobs[0].customerId);
    const before = await pg.evaluate(() => Store.data.customers.length);
    await pg.evaluate(id => openCustomerForm(id), busy); await pg.waitForTimeout(250);
    await pg.click('[data-del-customer]'); await pg.waitForTimeout(250);
    if (await ask()) throw new Error('it offered to delete: ' + await ask());
    const said = await pg.evaluate(() => document.body.innerText);
    if (!/still has \d+ job/.test(said)) throw new Error('did not say why');
    if (await pg.evaluate(() => Store.data.customers.length) !== before) throw new Error('deleted anyway');
    await pg.evaluate(() => closeModal());
  });
  await t('one with nothing on it asks first, and Cancel keeps it', async () => {
    await pg.evaluate(id => openCustomerForm(id), lone); await pg.waitForTimeout(250);
    await pg.click('[data-del-customer]'); await pg.waitForTimeout(250);
    if (!/Delete Sam Scratch\?/.test(await ask()) || !/cannot be undone/.test(await ask())) throw new Error('asked: ' + await ask());
    await pg.click('#ask-root [data-ask="no"]'); await pg.waitForTimeout(200);
    if (!await pg.evaluate(id => !!Store.customer(id), lone)) throw new Error('gone on Cancel');
  });
  await t('Delete customer removes that one customer and nobody else', async () => {
    const before = await pg.evaluate(() => Store.data.customers.length);
    await pg.click('[data-del-customer]'); await pg.waitForTimeout(250);
    await pg.click('#ask-root [data-ask="yes"]'); await pg.waitForTimeout(300);
    if (await pg.evaluate(id => !!Store.customer(id), lone)) throw new Error('still there');
    if (await pg.evaluate(() => Store.data.customers.length) !== before - 1) throw new Error('count wrong');
    const saved = await pg.evaluate(id => JSON.parse(localStorage.getItem('pcp.dispatch.v1')).customers.some(c => c.id === id), lone);
    if (saved) throw new Error('not saved — it would come back on reload');
  });

  console.log('--- the list behind the estimate window ---');
  const eid = await pg.evaluate(() => {
    const e = { id: uid('est'), no: 7301, createdAt: Date.now(), status:'draft', type:'Leak Repair', service:'',
      description:'Drip under the sink', validDays:30, customerId: Store.data.customers[0].id,
      items:[{ desc:'Replace the trap', kind:'labor', qty:1, price:145 }], flatPrice:null,
      materials:[], timeEntries:[], photos:[], log:[], visitDate:null, window:'Anytime', techId:null, scopeOf:null, chosen:null };
    Store.data.estimates.push(e); Store.save(); go('estimates'); render(); return e.id;
  });
  const row = () => pg.evaluate(i => { const r = document.querySelector(`#view [data-estimate="${i}"]`); return r ? r.innerText.replace(/\s+/g,' ') : ''; }, eid);
  await t('adding a line updates the Estimates row while the window is still open', async () => {
    if (!/1 line\b/.test(await row())) throw new Error('row before: ' + await row());
    await pg.evaluate(i => openEstimate(i), eid); await pg.waitForTimeout(300);
    await pg.fill('#line-desc', 'Shut-off valve'); await pg.fill('#line-price', '60');
    await pg.click(`[data-add-line="${eid}"]`); await pg.waitForTimeout(400);
    if (!await pg.$('#modal-root .modal')) throw new Error('the window closed, so this proves nothing');
    if (!/2 lines/.test(await row()) || !/\$205\.00/.test(await row())) throw new Error('row behind still old: ' + await row());
  });
  await t('an add-on keeps the row at $205 — it is priced, but outside the total', async () => {
    await pg.fill('#addon-desc', 'New supply lines, if they are corroded'); await pg.fill('#addon-price', '80');
    await pg.click(`[data-addon-add="${eid}"]`); await pg.waitForTimeout(400);
    if (!await pg.$('#modal-root .modal')) throw new Error('window closed');
    if (!/\$205\.00/.test(await row()) || /\$285/.test(await row())) throw new Error('row: ' + await row());
  });

  await b.close();
  const hard = errs.filter(e=>/CONSOLE|PAGEERROR|POP-UP/.test(e));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
