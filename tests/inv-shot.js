/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const seed = () => {
    Object.assign(Store.data.settings, { gst:'123456789 RT0001', gstRate:5, invoiceTerms:15 });
    const jobs = Store.data.jobs.slice(0,3);
    jobs.forEach(j => { if (!(j.parts && j.parts.length))
      j.parts = [{ id:'p'+j.no, name:'Parts and materials', qty:1, price:118 }]; });
    // one waiting to be billed
    if (jobs[0]) { const j = jobs[0]; j.status='complete'; j.laborHours=2; j.laborRate=145;
      j.payment = blankPayment(); j.invoiceNo=null; j.invoicedOn=null; }
    // one out and inside terms
    if (jobs[1]) { const j = jobs[1]; j.status='complete'; j.laborHours=1.5; j.laborRate=145;
      Store.invoiceNoFor(j); j.invoicedOn = addDays(todayStr(), -4);
      j.payment = Object.assign(blankPayment(), { status:'invoiced', ref:'INV-'+j.invoiceNo, invoicedAt:Date.now() }); }
    // one overdue and part paid
    if (jobs[2]) { const j = jobs[2]; j.status='complete'; j.laborHours=3; j.laborRate=145;
      Store.invoiceNoFor(j); j.invoicedOn = addDays(todayStr(), -23);
      j.payment = Object.assign(blankPayment(), { status:'invoiced', amountPaid:200, method:'Cash',
        ref:'INV-'+j.invoiceNo, invoicedAt:Date.now() }); }
    Store.save();
  };
  for (const [name, vp] of [['inv-desktop',{width:1280,height:1100}], ['inv-phone',{width:390,height:844}]]){
    const pg = await b.newPage({ viewport: vp });
    await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);
    await pg.evaluate(seed);
    await pg.evaluate(() => { App.view='invoices'; App.invTab='out'; render(); });
    await pg.waitForTimeout(400);
    await pg.screenshot({ path: process.env.SP + '/shots/' + name + '.png', fullPage: vp.width < 500 });
    await pg.evaluate(() => { App.invTab='tosend'; render(); }); await pg.waitForTimeout(300);
    await pg.screenshot({ path: process.env.SP + '/shots/' + name + '-tosend.png', fullPage: vp.width < 500 });
    await pg.close();
  }
  await b.close(); console.log('shot');
})();
