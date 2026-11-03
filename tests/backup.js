/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const fs = require('fs'); const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:390,height:844}, acceptDownloads:true });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  let saved = null;

  await t('the export button is reachable on a phone', async () => {
    await pg.evaluate(() => go('data')); await pg.waitForTimeout(400);
    const btn = await pg.$('[data-action="export"]');
    if (!btn) throw new Error('no export button');
    await btn.scrollIntoViewIfNeeded();
    const vis = await pg.evaluate(() => {
      const el = document.querySelector('[data-action="export"]');
      const r = el.getBoundingClientRect();
      const nav = document.getElementById('mobile-nav').getBoundingClientRect();
      return { onScreen: r.top >= 0 && r.bottom <= window.innerHeight, clearsNav: r.bottom <= nav.top,
               label: el.textContent.trim() };
    });
    if (!vis.onScreen) throw new Error('not scrollable into view');
    if (!vis.clearsNav) throw new Error('sits under the bottom nav');
    console.log('       "' + vis.label + '" under Backup & restore');
  });

  await t('tapping it produces a real file', async () => {
    // put something identifiable in the shop first
    await pg.evaluate(() => {
      Store.data.customers[0].name = "Backup Canary Ltd.";
      Store.addEntry('job', Store.data.jobs[0].id, Date.now()-3600000, Date.now(), 'canary trip');
      Store.data.jobs[0].materialCost = 1234.56;
      const tpl = Store.data.waiverTemplates[0];
      Store.data.signedWaivers.push({
        id:'wv_canary', no: 5001, templateId: tpl.id, title: tpl.title,
        body: 'frozen canary text', jobId: Store.data.jobs[0].id,
        customerId: Store.data.customers[0].id, signerName: 'Canary Signer',
        signatureData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        acks: [], signedAt: Date.now()
      });
      Store.save();
    });
    const [dl] = await Promise.all([
      pg.waitForEvent('download', { timeout: 8000 }),
      pg.click('[data-action="export"]')
    ]);
    saved = process.env.SP + '/' + dl.suggestedFilename();
    await dl.saveAs(saved);
    const raw = fs.readFileSync(saved, 'utf8');
    const j = JSON.parse(raw);
    if (!Array.isArray(j.jobs)) throw new Error('no jobs array');
    console.log('       ' + dl.suggestedFilename() + ' · ' + (raw.length/1024).toFixed(1) + ' KB');
  });

  await t('the file contains everything, not just jobs', async () => {
    const j = JSON.parse(fs.readFileSync(saved,'utf8'));
    const want = ['jobs','estimates','customers','techs','priceBook','waiverTemplates','signedWaivers','settings'];
    const missing = want.filter(k => j[k] === undefined);
    if (missing.length) throw new Error('missing: '+missing.join(', '));
    if (!j.settings.messages || !j.settings.zones) throw new Error('settings incomplete');
    const canary = j.customers.find(c => c.name === 'Backup Canary Ltd.');
    if (!canary) throw new Error('recent edit not in the file');
    if (!j.jobs[0].timeEntries || !j.jobs[0].timeEntries.length) throw new Error('time entries not saved');
    if (j.jobs[0].materialCost !== 1234.56) throw new Error('parts cost not saved');
    console.log('       ' + want.length + ' sections, incl. time entries and parts costs');
  });

  await t('wiping the device and importing the file brings the shop back', async () => {
    const before = await pg.evaluate(() => JSON.stringify(Store.data));
    await pg.evaluate(() => { localStorage.clear(); });
    await pg.reload(); await pg.waitForTimeout(500);
    const wiped = await pg.evaluate(() => Store.data.customers.some(c => c.name === 'Backup Canary Ltd.'));
    if (wiped) throw new Error('clear did not actually wipe');

    await pg.evaluate(() => go('data')); await pg.waitForTimeout(350);
    pg.once('dialog', d => d.accept());          // import asks before overwriting
    await pg.setInputFiles('#import-file', saved);
    await pg.waitForTimeout(700);

    const after = await pg.evaluate(() => JSON.stringify(Store.data));
    const a = JSON.parse(before), z = JSON.parse(after);
    if (!z.customers.some(c => c.name === 'Backup Canary Ltd.')) throw new Error('canary customer did not come back');
    if (z.jobs.length !== a.jobs.length) throw new Error(`jobs ${a.jobs.length} -> ${z.jobs.length}`);
    if (JSON.stringify(z.jobs[0].timeEntries) !== JSON.stringify(a.jobs[0].timeEntries)) throw new Error('time entries changed');
    if (z.jobs[0].materialCost !== 1234.56) throw new Error('parts cost lost');
    if (z.signedWaivers.length !== a.signedWaivers.length) throw new Error('signed waivers lost');
    const w = z.signedWaivers.find(x => x.id === 'wv_canary');
    if (!w) throw new Error('signed waiver missing');
    if (!/^data:image\/png;base64,/.test(w.signatureData || '')) throw new Error('signature image lost');
    if (w.body !== 'frozen canary text') throw new Error('frozen waiver text changed');
    console.log('       ' + z.jobs.length + ' jobs, ' + z.customers.length + ' customers, '
      + z.signedWaivers.length + ' signed waiver(s) restored intact');
  });

  await t('and it survives the reload after importing', async () => {
    await pg.reload(); await pg.waitForTimeout(500);
    const ok = await pg.evaluate(() => Store.data.customers.some(c => c.name === 'Backup Canary Ltd.'));
    if (!ok) throw new Error('import did not persist');
    console.log('       still there after a restart');
  });

  await t('a junk file is refused instead of wiping the shop', async () => {
    await pg.evaluate(() => go('data')); await pg.waitForTimeout(350);
    const bad = process.env.SP + '/not-a-backup.json';
    fs.writeFileSync(bad, '{"hello":"world"}');
    pg.once('dialog', d => d.accept());
    await pg.setInputFiles('#import-file', bad);
    await pg.waitForTimeout(600);
    const ok = await pg.evaluate(() => Store.data.customers.some(c => c.name === 'Backup Canary Ltd.'));
    if (!ok) throw new Error('a junk import destroyed the real data');
    console.log('       shop untouched');
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
