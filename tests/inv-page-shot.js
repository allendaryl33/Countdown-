const { chromium } = require(process.env.PW || 'playwright-core');
const APP='http://127.0.0.1:54321/index.html', URL_='http://127.0.0.1:54321', KEY='sb_publishable_test';
const fs=require('fs');
(async () => {
  await fetch(URL_+'/__reset');
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const pg = await b.newPage({ viewport:{width:1280,height:1000} });
  await pg.goto(APP); await pg.waitForTimeout(400);
  await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'S'}; Cloud.saveCfg();
    return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY]);
  await pg.waitForTimeout(900);
  const shot = (n) => fs.readFileSync(process.env.SP + '/' + n);
  const b64 = n => fs.readFileSync(process.env.SP + '/' + n).toString('base64');
  const link = await pg.evaluate(async ([p1,p2]) => {
    Object.assign(Store.data.settings, { gst:'123456789 RT0001', gstRate:5,
      email:'admin@poseidonplumbing.ca', website:'poseidonplumbing.ca', address:'Edmonton, AB',
      payStripeUrl:'https://buy.stripe.com/test_abc', payEtransfer:'admin@poseidonplumbing.ca',
      payCash:true, invoiceTermsMode:'completion' });
    const j = Store.data.jobs.find(x => (x.parts||[]).length) || Store.data.jobs[0];
    j.laborHours = 2; j.laborRate = 145; j.status='complete'; j.payment = blankPayment();
    Store.signWaiver(Store.activeTemplates()[0], { job:j, signerName:'Daryl A',
      signerRole:'Homeowner', fillIns:'', signature:'data:image/png;base64,'+'A'.repeat(400) });
    j.photos = [];
    const imgs = [p1, p2];
    for (let i=0;i<2;i++){
      const bin = Uint8Array.from(atob(imgs[i]), c => c.charCodeAt(0));
      const path = 'jobs/'+j.id+'/'+(i?'after':'before')+'.jpg';
      await Cloud.uploadPhoto(path, new Blob([bin], {type:'image/jpeg'}));
      j.photos.push({ id:uid('ph'), path, tag: i?'after':'before', up:true, at:Date.now() });
    }
    Store.save();
    const tok = await Cloud.publishInvoiceLink(j);
    return invoiceLinkUrl(tok);
  }, [b64('testphoto.jpg'), b64('geotagged.jpg')]);
  const cust = await b.newPage({ viewport:{width:390,height:900} });
  await cust.goto(link); await cust.waitForTimeout(1400);
  await cust.screenshot({ path: process.env.SP+'/shots/invoice-page.png', fullPage:true });
  await b.close(); console.log('shot');
})();
