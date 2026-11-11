/* Money to the cent, exactly — checked against whole-number arithmetic.

   GST was worked out with Math.round(x * 100) / 100, which rounds some half
   cents down because 20.70 * 0.05 * 100 is 103.49999… in floating point:
   5% of $20.70 is $1.035 and the invoice said $1.03. Across subtotals from
   $0.01 to $5,000 that was a cent short 408 times.

   The truth here is computed in integer cents, where there is no floating
   point to go wrong: tax cents = floor((subtotal cents × rate + 50) / 100),
   i.e. half a cent rounds up. The app has to agree on every one.          */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP=`file://${REPO_DIR}/index.html`, errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage();
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await pg.goto(APP); await pg.waitForTimeout(500);
  await pg.evaluate(()=>localStorage.clear()); await pg.reload(); await pg.waitForTimeout(400);

  console.log('--- GST ---');
  for (const rate of [5, 13]){
    await t(`${rate}% tax is right to the cent on every subtotal from $0.01 to $5,000`, async () => {
      const r = await pg.evaluate(rate => {
        Object.assign(Store.data.settings, { gst:'123456789 RT0001', gstRate: rate });
        const j = Store.data.jobs[0];
        j.flatPrice = null; j.laborHours = 0; j.billWith = null;
        const off = [];
        for (let c = 1; c <= 500000; c++){
          const want = Math.floor((c * rate + 50) / 100);          // integer cents, half up
          const got = Math.round(Number((cents((c / 100) * Store.taxRate()) * 100).toFixed(6)));
          if (got !== want) off.push([c / 100, got / 100, want / 100]);
        }
        // and through the real invoice path, on the ones that used to go wrong
        const real = [20.70, 0.70, 2.90, 43.90, 47.30].map(sub => {
          j.parts = [{ desc:'Work', qty:1, price: sub }];
          return [sub, Store.taxOn(j), Store.invoiceTotal(j)];
        });
        return { off: off.length, first: off.slice(0, 5), real };
      }, rate);
      if (r.off) throw new Error(r.off + ' subtotals off by a cent, e.g. ' + JSON.stringify(r.first));
      for (const [sub, tax, tot] of r.real){
        const want = Math.floor((Math.round(sub * 100) * rate + 50) / 100) / 100;
        if (tax !== want) throw new Error(`${rate}% of $${sub}: app says ${tax}, should be ${want}`);
        if (Math.abs(tot - (sub + want)) > 1e-9) throw new Error(`total on $${sub}: ${tot}`);
      }
      if (rate === 5) console.log('       5% of $20.70 = ' + r.real[0][1] + ', total ' + r.real[0][2]);
    });
  }

  console.log('--- the amount Stripe opens with ---');
  await t('every balance from $0.01 to $10,000 becomes exactly its cents', async () => {
    const off = await pg.evaluate(() => {
      const bad = [];
      for (let c = 1; c <= 1000000; c++){
        const bal = cents(c / 100);
        const got = Math.round(Number((bal * 100).toFixed(6)));
        if (got !== c) bad.push([c, got]);
      }
      return bad.slice(0, 5).concat([bad.length]);
    });
    if (off[off.length - 1]) throw new Error(JSON.stringify(off));
  });
  await t('a part payment leaves a balance exact to the cent', async () => {
    const r = await pg.evaluate(() => {
      const j = Store.data.jobs[0];
      Object.assign(Store.data.settings, { gst:'123456789 RT0001', gstRate: 5 });
      j.parts = [{ desc:'Work', qty:1, price: 320.15 }];
      j.payment = Object.assign(blankPayment(), { status:'invoiced', amountPaid: 100.10 });
      return { total: Store.invoiceTotal(j), bal: Store.balance(j) };
    });
    // 320.15 + 16.0075 → 16.01 tax → 336.16; less 100.10 → 236.06
    if (r.total !== 336.16) throw new Error('total ' + r.total);
    if (r.bal !== 236.06) throw new Error('balance ' + r.bal);
  });

  await b.close();
  const hard = errs.filter(e=>e.includes('CONSOLE')||e.includes('PAGEERROR'));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
