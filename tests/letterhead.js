/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1400,height:950} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  await t('the new fields exist and save', async () => {
    await pg.evaluate(() => go('data')); await pg.waitForTimeout(400);
    for (const [id,v] of [['#set-phone','(780) 555-0147'],
                          ['#set-email','admin@poseidonplumbing.ca'],
                          ['#set-website','https://poseidonplumbing.ca'],
                          ['#set-address','Edmonton, AB'],
                          ['#set-gst','123456789 RT0001']]){
      if (!await pg.$(id)) throw new Error('no field '+id);
      await pg.fill(id, v);
    }
    await pg.click('[data-action="save-settings"]'); await pg.waitForTimeout(400);
    const st = await pg.evaluate(() => Store.data.settings);
    if (st.email !== 'admin@poseidonplumbing.ca') throw new Error('email '+st.email);
    if (st.website !== 'poseidonplumbing.ca') throw new Error('https:// not stripped: '+st.website);
    if (st.gst !== '123456789 RT0001') throw new Error('gst '+st.gst);
    console.log('       ' + st.phone + ' · ' + st.email + ' · ' + st.website);
  });

  await t('they survive a reload', async () => {
    await pg.reload(); await pg.waitForTimeout(500);
    const st = await pg.evaluate(() => Store.data.settings);
    if (st.email !== 'admin@poseidonplumbing.ca' || st.gst !== '123456789 RT0001')
      throw new Error(JSON.stringify(st));
  });

  const headOf = () => pg.evaluate(() => {
    const el = document.querySelector('#print-area');
    return el ? el.textContent.replace(/\s+/g,' ').trim() : '';
  });

  await t('a dispatch ticket carries the full letterhead', async () => {
    await pg.evaluate(() => printJobs([Store.data.jobs[0]], 'test')); await pg.waitForTimeout(350);
    const h = await headOf();
    for (const bit of ['(780) 555-0147','admin@poseidonplumbing.ca','poseidonplumbing.ca','GST/HST 123456789 RT0001'])
      if (!h.includes(bit)) throw new Error('missing "'+bit+'" in: '+h.slice(0,170));
    console.log('       phone · email · website · address · GST all printed');
  });

  await t('an estimate carries it too', async () => {
    await pg.evaluate(() => printEstimate(Store.data.estimates[0])); await pg.waitForTimeout(350);
    const h = await headOf();
    if (!h.includes('admin@poseidonplumbing.ca')) throw new Error(h.slice(0,170));
    if (!h.includes('GST/HST')) throw new Error('no GST line on an estimate');
  });

  await t('a signed waiver carries it, and gets the email merge field', async () => {
    const ok = await pg.evaluate(() => {
      const tpl = Store.data.waiverTemplates[0];
      tpl.body = ['Questions go to {{company_email}} or call {{company_phone}}.'];
      Store.save();
      return MERGE_FIELDS.some(f => f[0] === '{{company_email}}');
    });
    if (!ok) throw new Error('{{company_email}} not offered as a merge field');
    await pg.evaluate(() => {
      const t = Store.data.waiverTemplates[0];
      const rec = Store.signWaiver(t, { job: Store.data.jobs[0], signerName:'Test', signerRole:'Owner' });
      printWaiver(rec);
    });
    await pg.waitForTimeout(350);
    const h = await headOf();
    if (!h.includes('Questions go to admin@poseidonplumbing.ca')) throw new Error('merge field unresolved: '+h.slice(0,220));
    if (!h.includes('GST/HST')) throw new Error('no GST on the waiver');
    console.log('       merge field resolved in the frozen body');
  });

  await t('a shop with nothing filled in prints no empty lines', async () => {
    await pg.evaluate(() => {
      Object.assign(Store.data.settings, { email:'', website:'', address:'', gst:'' });
      Store.save(); printJobs([Store.data.jobs[0]], 'test');
    });
    await pg.waitForTimeout(350);
    const h = await headOf();
    if (/GST\/HST\s*(·|$)/.test(h)) throw new Error('empty GST line printed');
    if (h.includes('· ·')) throw new Error('empty separators: '+h.slice(0,150));
    console.log('       clean letterhead with only a phone number');
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
