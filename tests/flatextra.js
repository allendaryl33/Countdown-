/* A flat job is the agreed price plus anything priced added afterwards.
   He agrees an extra on site — a kit upgrade, a part the customer picked —
   enters it as a priced line, and it has to reach the invoice. It used to be
   dropped entirely: the flat price was returned and every line ignored. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:430,height:950} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  const jid = await pg.evaluate(() => {
    const j = Store.data.jobs[0];
    Object.assign(j, { flatPrice: 8500, laborHours: 0,
      laborRate: Store.data.settings.laborRate || 145,
      parts: [ { desc:"Demo and haul away",  qty:1, price:0 },
               { desc:"Rough-in the valve",  qty:1, price:0 },
               { desc:"Waterproof and tile", qty:1, price:0 } ] });
    Store.data.settings.gst = ""; Store.save(); return j.id;
  });
  const tot   = () => pg.evaluate(id => Store.jobTotal(Store.job(id)), jid);
  const lines = () => pg.evaluate(id => Store.invoiceLines(Store.job(id)), jid);

  await t('with nothing added, the agreed price stands', async () => {
    const n = await tot();
    if (n !== 8500) throw new Error('total is ' + n + ', wanted 8500');
  });

  await t('the scope shows without prices against it, as before', async () => {
    const l = await lines();
    if (l.length !== 3) throw new Error(l.length + ' lines, wanted the 3 scope lines');
    if (!l.every(x => x.scope && x.price === 0)) throw new Error(JSON.stringify(l));
  });

  await t('an approved extra raises the total by exactly its amount', async () => {
    await pg.evaluate(id => {
      Store.job(id).parts.push({ desc:"Upgraded valve kit", qty:1, price:500 });
      Store.save(); }, jid);
    const n = await tot();
    if (n !== 9000) throw new Error('total is ' + n + ', wanted 9000');
  });

  await t('and the invoice adds up, with the agreed price shown as its own line', async () => {
    const l = await lines();
    const agreed = l.find(x => x.desc === "Agreed price");
    if (!agreed) throw new Error('nothing shows where the 8500 comes from: ' + JSON.stringify(l));
    if (agreed.qty * agreed.price !== 8500) throw new Error('agreed line is ' + JSON.stringify(agreed));
    const sum = l.reduce((s,x) => s + x.qty * x.price, 0);
    if (sum !== 9000) throw new Error('lines add to ' + sum + ' but the total is 9000');
    if (!l.some(x => x.desc === "Upgraded valve kit" && x.price === 500))
      throw new Error('the extra is not itemised');
  });

  await t('a quantity on the extra multiplies properly', async () => {
    await pg.evaluate(id => {
      const j = Store.job(id);
      j.parts[j.parts.length-1].qty = 3; Store.save(); }, jid);
    const n = await tot();
    if (n !== 8500 + 1500) throw new Error('total is ' + n + ', wanted 10000');
  });

  await t('his logged hours are still not billed on a flat job', async () => {
    const n = await pg.evaluate(id => {
      const j = Store.job(id);
      j.laborHours = 12; j.laborRate = 145; Store.save();
      return Store.jobTotal(j); }, jid);
    if (n !== 10000)
      throw new Error('clocking 12 hours changed the total to ' + n + ' — the clock is his record, not a charge');
  });

  await t('the money owed and the invoice total follow it', async () => {
    const r = await pg.evaluate(id => {
      const j = Store.job(id);
      j.payment = Object.assign(blankPayment(), { status:"invoiced", amountPaid: 0 });
      Store.save();
      return { inv: Store.invoiceTotal(j), bal: Store.balance(j) }; }, jid);
    if (r.inv !== 10000) throw new Error('invoice total is ' + r.inv);
    if (r.bal !== 10000) throw new Error('balance is ' + r.bal);
  });

  await t('a part-payment leaves the right balance', async () => {
    const bal = await pg.evaluate(id => {
      const j = Store.job(id); j.payment.amountPaid = 2500; Store.save();
      return Store.balance(j); }, jid);
    if (bal !== 7500) throw new Error('balance is ' + bal);
  });

  await t('taking the extra away puts it back to the agreed price', async () => {
    const r = await pg.evaluate(id => {
      const j = Store.job(id);
      j.parts = j.parts.filter(p => p.desc !== "Upgraded valve kit"); Store.save();
      return { total: Store.jobTotal(j), lines: Store.invoiceLines(j) }; }, jid);
    if (r.total !== 8500) throw new Error('total is ' + r.total);
    if (r.lines.some(x => x.desc === "Agreed price"))
      throw new Error('the agreed-price line should go once there is nothing to add up');
  });

  await t('an hourly job is untouched by any of this', async () => {
    const n = await pg.evaluate(id => {
      const j = Store.job(id);
      j.flatPrice = null; j.laborHours = 4; j.laborRate = 150;
      j.parts = [{ desc:"Cartridge", qty:2, price:60 }];
      Store.save(); return Store.jobTotal(j); }, jid);
    if (n !== 4*150 + 120) throw new Error('hourly total is ' + n + ', wanted 720');
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
