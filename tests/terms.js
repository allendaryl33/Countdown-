/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it if the app lives elsewhere. */
const APP = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1280,height:1100} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${APP}/index.html`); await pg.waitForTimeout(450);

  const jid = await pg.evaluate(() => {
    const j = Store.data.jobs.find(x => (x.parts||[]).length) || Store.data.jobs[0];
    j.laborHours = 2; j.laborRate = 145; j.status = 'complete';
    Store.data.settings.gst = ''; Store.save();
    Store.invoiceNoFor(j); return j.id;
  });
  const inv = async () => {
    await pg.evaluate(() => closeModal());
    await pg.evaluate(id => previewInvoice(id), jid); await pg.waitForTimeout(800);
    return pg.evaluate(() => document.querySelector('.inv-preview').textContent.replace(/\s+/g,' '));
  };

  await t('days terms still print a real due date', async () => {
    await pg.evaluate(() => { Object.assign(Store.data.settings,
      { invoiceTermsMode:'days', invoiceTerms:15 }); Store.save(); });
    const tx = await inv();
    if (!/Payment due [A-Z][a-z]+ \d+/.test(tx)) throw new Error('no due date: ' + tx.slice(0,200));
    const due = await pg.evaluate(id => Store.invoiceDue(Store.job(id)), jid);
    if (!due) throw new Error('no due date computed');
  });

  await t('on completion prints that instead, and no date', async () => {
    await pg.evaluate(() => { Store.data.settings.invoiceTermsMode = 'completion'; Store.save(); });
    const tx = await inv();
    if (!/Payment due on completion of work/.test(tx)) throw new Error(tx.slice(0,220));
    if (/Payment due [A-Z][a-z]+ \d+/.test(tx)) throw new Error('still printed a date too');
    const due = await pg.evaluate(id => Store.invoiceDue(Store.job(id)), jid);
    if (due) throw new Error('still computed a due date: ' + due);
  });

  await t('it says it on the job record too, not just the printed invoice', async () => {
    await pg.evaluate(() => closeModal());
    const line = await pg.evaluate(id => Store.termsLine(Store.job(id)), jid);
    if (!/on completion of work/.test(line)) throw new Error(line);
  });

  console.log('--- the setting ---');
  await t('the days box is hidden on completion and shown for days', async () => {
    await pg.evaluate(() => { App.view='data'; App.search=''; render(); }); await pg.waitForTimeout(400);
    const shown = () => pg.evaluate(() => {
      const n = document.querySelector('#set-terms');
      return n ? getComputedStyle(n).display !== 'none' : null;
    });
    if (await shown() !== false) throw new Error('days box visible while on completion');
    await pg.selectOption('#set-terms-mode', 'days'); await pg.waitForTimeout(250);
    if (await shown() !== true) throw new Error('days box stayed hidden after switching');
    await pg.selectOption('#set-terms-mode', 'completion'); await pg.waitForTimeout(250);
    if (await shown() !== false) throw new Error('days box stayed visible after switching back');
  });

  await t('switching it does not wipe what he was typing', async () => {
    await pg.fill('#set-rate', '160');
    await pg.selectOption('#set-terms-mode', 'days'); await pg.waitForTimeout(250);
    const kept = await pg.inputValue('#set-rate');
    if (kept !== '160') throw new Error('labor rate became ' + kept);
  });

  await t('the choice saves and survives a reload', async () => {
    await pg.selectOption('#set-terms-mode', 'completion'); await pg.waitForTimeout(200);
    await pg.evaluate(() => { const b = Array.from(document.querySelectorAll('button'))
      .find(x => /Save settings/i.test(x.textContent)); b.click(); });
    await pg.waitForTimeout(500);
    await pg.reload(); await pg.waitForTimeout(600);
    const m = await pg.evaluate(() => Store.data.settings.invoiceTermsMode);
    if (m !== 'completion') throw new Error('saved as ' + m);
  });

  await t('an older shop with no setting keeps behaving as it did', async () => {
    const m = await pg.evaluate(() => {
      delete Store.data.settings.invoiceTermsMode;
      Store.backfill();
      return Store.data.settings.invoiceTermsMode;
    });
    if (m !== 'days') throw new Error('defaulted to ' + m + ', which changes existing invoices');
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
