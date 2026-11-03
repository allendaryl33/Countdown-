/* Bob Down signed it and the job turned up under Daryl, because Daryl's
   phone number was on the lead. */
/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:430,height:900} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  const PHONE = "780-566-2014";   // his own number, on every test lead
  await pg.evaluate(p => {
    Store.data.customers.push({ id: uid("cus"), name:"Daryl", phone:p,
      email:"", address:"10727 50 St NW", city:"Edmonton", zone:"city",
      notes:"", createdAt: Date.now() });
    Store.save();
  }, PHONE);

  const match = (name, phone) => pg.evaluate(([n,p]) => {
    const c = Store.customerForLead({ name:n, phone:p });
    return c ? c.name : null;
  }, [name, phone]);

  await t('a different name on the same number is a different person', async () => {
    const who = await match("Bob Down", PHONE);
    if (who === "Daryl") throw new Error('Bob Down matched Daryl off the shared number');
    if (who !== null) throw new Error('matched somebody unexpected: ' + who);
  });

  await t('the same person on the same number is still the same person', async () => {
    const who = await match("Daryl", PHONE);
    if (who !== "Daryl") throw new Error('lost a real repeat customer, got ' + who);
  });

  await t('a fuller version of the same name still matches', async () => {
    const who = await match("Daryl Allen", PHONE);
    if (who !== "Daryl") throw new Error('"Daryl Allen" did not match "Daryl", got ' + who);
  });

  await t('with no name at all, the number is all there is to go on', async () => {
    const who = await match("", PHONE);
    if (who !== "Daryl") throw new Error('should fall back to the number, got ' + who);
  });

  await t('a different number and a known name still matches by name', async () => {
    const who = await match("Daryl", "780-555-0000");
    if (who !== "Daryl") throw new Error('name match lost, got ' + who);
  });

  await t('signing as Bob Down puts the job on Bob Down', async () => {
    const r = await pg.evaluate(p => {
      const src = Store.data.estimates.find(x => (x.items||[]).length);
      const e = JSON.parse(JSON.stringify(src));
      e.id = uid("est"); e.no = Store.nextEstNo(); e.status = "sent";
      delete e.approval; delete e.jobId; e.customerId = null;
      e.lead = { name:"Bob Down", phone:p, email:"bob@example.com",
                 address:"1 Elsewhere Ave", city:"Edmonton" };
      Store.data.estimates.push(e);
      Store.signEstimate(e, { name:"Bob Down", signature:"data:image/png;base64,iVBORw0KGgo=" });
      const j = e.jobId ? Store.job(e.jobId) : null;
      return j ? Store.customer(j.customerId).name : null;
    }, PHONE);
    if (r === "Daryl") throw new Error('the job landed on Daryl again');
    if (r !== "Bob Down") throw new Error('job is on "' + r + '"');
  });

  await t('and Daryl did not quietly acquire a second record', async () => {
    const n = await pg.evaluate(() =>
      Store.data.customers.filter(c => c.name === "Daryl").length);
    if (n !== 1) throw new Error('Daryl now exists ' + n + ' times');
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
