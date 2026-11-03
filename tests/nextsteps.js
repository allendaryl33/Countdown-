/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1400,height:1100} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);
  const panel = async () => {
    await pg.evaluate(() => { App.view='data'; render(); }); await pg.waitForTimeout(300);
    return pg.evaluate(() => {
      const h = Array.from(document.querySelectorAll('.card-head h3')).find(x => /Next steps/.test(x.textContent));
      return h ? h.closest('.card').textContent.replace(/\s+/g,' ').trim() : '';
    });
  };

  await t('it no longer claims built features are missing', async () => {
    const tx = await panel();
    for (const gone of ['Photos —', 'Customer text or email confirmations',
                        'Sending real invoices, rather than recording']){
      if (tx.includes(gone)) throw new Error('still says: ' + gone);
    }
  });

  await t('an unconnected device is told to connect', async () => {
    const tx = await panel();
    if (!/Connect this device/.test(tx)) throw new Error(tx.slice(0,200));
  });

  await t('a connected device stops being told to connect', async () => {
    await pg.evaluate(() => {
      Cloud.cfg = { url:'https://x.supabase.co', key:'k', refreshToken:'r', email:'a@b.c', deviceId:'d' };
    });
    const tx = await panel();
    if (/Connect this device/.test(tx)) throw new Error('still nagging a synced device');
  });

  await t('no GST number is called out, and having one clears it', async () => {
    let tx = await panel();
    if (!/GST number/.test(tx)) throw new Error('no GST line with the field empty');
    await pg.evaluate(() => { Store.data.settings.gst = '123456789 RT0001'; Store.save(); });
    tx = await panel();
    if (/GST number, once/.test(tx)) throw new Error('still asking after it was filled in');
  });

  await t('it names exactly which business details are blank', async () => {
    await pg.evaluate(() => { Object.assign(Store.data.settings,
      { email:'admin@poseidonplumbing.ca', website:'', address:'' }); Store.save(); });
    const tx = await panel();
    if (/a business email/.test(tx)) throw new Error('asked for an email that is on file');
    if (!/your website/.test(tx) || !/a business address/.test(tx))
      throw new Error('did not name the blank ones: ' + tx.slice(0,250));
  });

  await t('the demo warning goes once the shop is live', async () => {
    let tx = await panel();
    if (!/Clear the demo/.test(tx)) throw new Error('no demo warning on a sample shop');
    await pg.evaluate(() => { Store.data.liveSince = Date.now(); Store.save(); });
    tx = await panel();
    if (/Clear the demo/.test(tx)) throw new Error('still warning after going live');
  });

  await t('the waivers warning never goes, because a lawyer never looked at them', async () => {
    const tx = await panel();
    if (!/waivers looked at/.test(tx)) throw new Error('dropped the liability warning');
    if (!/liability/.test(tx)) throw new Error('softened it');
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
