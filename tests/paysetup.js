/* Nov 13, sending Deanna's invoice (invented names here):

   - The e-Transfer box showed his address in grey. It looked saved; it was
     empty; the invoice went out with no e-Transfer on it.
   - Saving the address didn't change the invoice she already had, and
     nothing said it wouldn't.
   - Her $2,000 came in before the invoice was sent, and Part payment was
     only offered on sent invoices.
   - There was no "Interac e-Transfer" in the method list, so it went down
     as "ACH / bank transfer".                                            */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP=`file://${REPO_DIR}/index.html`, errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1280,height:1000} });
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('dialog', d => { errs.push('BROWSER POP-UP: ' + d.message()); d.dismiss(); });
  await pg.goto(APP); await pg.waitForTimeout(500);
  await pg.evaluate(()=>localStorage.clear()); await pg.reload(); await pg.waitForTimeout(400);

  console.log('--- an empty box looks empty ---');
  await t('the empty e-Transfer and card boxes say "Not set", not an address or a link', async () => {
    await pg.evaluate(() => { Store.data.settings.payEtransfer = ''; Store.data.settings.payStripeUrl = ''; Store.save(); go('data'); });
    await pg.waitForTimeout(300);
    const r = await pg.evaluate(() => ['#set-pay-etransfer', '#set-pay-stripe'].map(sel => {
      const el = document.querySelector(sel);
      return { v: el.value, ph: el.placeholder, italic: getComputedStyle(el, '::placeholder').fontStyle };
    }));
    for (const x of r){
      if (x.v !== '') throw new Error('box not empty: ' + x.v);
      if (!/^Not set/.test(x.ph)) throw new Error('hint could pass for a value: ' + x.ph);
      if (x.italic !== 'italic') throw new Error('hint is not set apart: ' + x.italic);
    }
    if (r[0].ph.includes('@')) throw new Error('the e-Transfer hint still shows an address');
  });
  await t('no hint in Data & Setup reads like a saved value', async () => {
    const bad = await pg.evaluate(() => [...document.querySelectorAll('#view input[placeholder], #view textarea[placeholder]')]
      .filter(el => /^set-/.test(el.id))
      .map(el => el.id + ': ' + el.placeholder)
      .filter(x => !/: (e\.g\.|Not set|Leave blank)/.test(x)));
    if (bad.length) throw new Error(bad.join(' | '));
  });

  console.log('--- a sent invoice is a snapshot, and says so ---');
  let jid;
  await t('Data & Setup says a sent invoice keeps the options it went out with', async () => {
    const tx = await pg.$eval('#view', e => e.textContent.replace(/\s+/g, ' '));
    if (!/already sent keeps the options it went out with/.test(tx)) throw new Error('not said');
  });
  await t('a sent invoice offers "Send it again" and says the fresh link has today\'s options', async () => {
    jid = await pg.evaluate(() => {
      const j = Store.data.jobs.find(x => (x.parts || []).length) || Store.data.jobs[0];
      j.status = 'complete'; j.billWith = null; j.payment = blankPayment();
      Store.setPayment(j, { status:'invoiced' }); Store.save(); previewInvoice(j.id); return j.id;
    });
    await pg.waitForTimeout(500);
    const foot = await pg.$eval('.modal-foot', e => e.textContent.replace(/\s+/g, ' '));
    if (!/Send it again/.test(foot)) throw new Error(foot);
    if (!/fresh link with today's payment options/.test(foot)) throw new Error(foot);
    await pg.evaluate(() => closeModal());
  });

  console.log('--- money in before the invoice goes out ---');
  await t('an invoice still to send offers Part payment', async () => {
    await pg.evaluate(id => { const j = Store.job(id); j.payment = blankPayment(); Store.save();
      App.invTab = 'tosend'; go('invoices'); }, jid);
    await pg.waitForTimeout(300);
    if (!await pg.$(`#view [data-inv-pay="${jid}"]`)) throw new Error('no Part payment on the To send row');
    await pg.evaluate(id => previewInvoice(id), jid); await pg.waitForTimeout(400);
    if (!await pg.$(`.modal [data-inv-pay="${jid}"]`)) throw new Error('no Part payment on the invoice screen');
    await pg.evaluate(() => closeModal());
  });
  await t('recording a part payment on it keeps it To send, with the payment and the balance right', async () => {
    await pg.click(`#view [data-inv-pay="${jid}"]`); await pg.waitForTimeout(300);
    await pg.fill('#ipay-amt', '100');
    await pg.selectOption('#ipay-method', 'Interac e-Transfer');
    await pg.click('[data-ipay-save]'); await pg.waitForTimeout(300);
    const r = await pg.evaluate(id => { const j = Store.job(id);
      return { st: j.payment.status, got: j.payment.amountPaid, m: j.payment.method, bal: Store.balance(j), total: Store.invoiceTotal(j) }; }, jid);
    if (r.total <= 100) throw new Error('the job is too small to part-pay: ' + r.total);
    if (r.st !== 'unbilled') throw new Error('marked "' + r.st + '" — it was never sent');
    if (r.got !== 100 || r.m !== 'Interac e-Transfer') throw new Error(JSON.stringify(r));
    if (Math.abs(r.bal - (r.total - 100)) > 0.005) throw new Error('balance ' + r.bal);
    const row = await pg.$eval('#view', e => e.textContent.replace(/\s+/g, ' '));
    if (!/Part paid — \$100\.00/.test(row)) throw new Error('row does not say part paid');
    console.log('       $100 of ' + r.total + ' in, ' + r.bal.toFixed(2) + ' owing, still To send');
  });
  await t('clearing that payment leaves it To send, not "waiting on payment"', async () => {
    await pg.click(`#view [data-inv-pay="${jid}"]`); await pg.waitForTimeout(300);
    await pg.click('[data-ipay-clear]'); await pg.waitForTimeout(300);
    const st = await pg.evaluate(id => Store.job(id).payment.status, jid);
    if (st !== 'unbilled') throw new Error('now ' + st);
  });

  console.log('--- the method list ---');
  await t('Interac e-Transfer is on the method list', async () => {
    const opts = await pg.evaluate(() => PAY_METHODS);
    if (!opts.includes('Interac e-Transfer')) throw new Error(opts.join(', '));
  });
  await t('a payment already saved as "ACH / bank transfer" still says so — nothing renamed', async () => {
    await pg.evaluate(id => { const j = Store.job(id); j.payment.method = 'ACH / bank transfer'; Store.save(); openJob(id); }, jid);
    await pg.waitForTimeout(300);
    const v = await pg.$eval('#pay-method', e => e.value);
    if (v !== 'ACH / bank transfer') throw new Error('shows ' + v);
  });

  await b.close();
  const hard = errs.filter(e=>/CONSOLE|PAGEERROR|POP-UP/.test(e));
  console.log('\n=== js errors: '+hard.length+' | failures: '+(errs.length-hard.length)+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
