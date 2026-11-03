const { chromium } = require(process.env.PW || 'playwright-core');
const APP='http://127.0.0.1:54321/index.html', URL_='http://127.0.0.1:54321', KEY='sb_publishable_test';
(async () => {
  await fetch(URL_+'/__reset');
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const pg = await b.newPage({ viewport:{width:1280,height:1000} });
  await pg.goto(APP); await pg.waitForTimeout(400);
  await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'S'}; Cloud.saveCfg();
    return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY]);
  await pg.waitForTimeout(900);
  const link = await pg.evaluate(async () => {
    Object.assign(Store.data.settings, { gst:'123456789 RT0001', gstRate:5,
      email:'admin@poseidonplumbing.ca', website:'poseidonplumbing.ca' });
    const e = Store.data.estimates.find(x => (x.items||[]).length);
    e.status='draft'; delete e.approval; Store.save();
    const tok = await Cloud.publishSignLink(e);
    return signLinkUrl(tok);
  });
  const cust = await b.newPage({ viewport:{width:390,height:900} });
  await cust.goto(link); await cust.waitForTimeout(1000);
  await cust.screenshot({ path: process.env.SP+'/shots/sign-page.png', fullPage:true });
  await b.close(); console.log('shot');
})();
