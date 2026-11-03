/* His trigger words, and the order things are read in: what they picked
   from the website dropdown wins; only if that lands on nothing is what
   they wrote read. */
/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1280,height:1000} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);
  const type = lead => pg.evaluate(l => Store.leadJobType(l), lead);

  await t('the seeded words catch what people actually type', async () => {
    const want = {
      "hot water tank":"Water Heater", "no hot water":"Water Heater",
      "blocked drain":"Drain Cleaning", "backed up":"Drain Cleaning",
      "plumbing - leaks":"Leak Repair", "dripping":"Leak Repair",
      "no heat":"Furnace", "in floor heat":"Boiler / Radiant Heat",
      "sump pump":"Well / Pump", "bbq line":"Gas Line",
      "sewer backup":"Sewer / Camera", "shower rebuild":"Remodel Rough-in",
      "bathroom remodel":"Remodel Rough-in", "back flow":"Backflow Test" };
    for (const [s,exp] of Object.entries(want)){
      const got = await type({ service:s });
      if (got !== exp) throw new Error(`"${s}" -> ${got}, wanted ${exp}`);
    }
  });

  await t('a longer phrase beats a shorter one inside it', async () => {
    // "water" alone would suit several; "hot water tank" is specific
    if (await type({ service:"hot water tank" }) !== "Water Heater") throw new Error('tank');
    // "gas" is a Gas Line word, "gas fitting" is the longer hit
    if (await type({ service:"gas fitting" }) !== "Gas Line") throw new Error('gas');
  });

  await t('a trigger phrase keeps its short words', async () => {
    // "no heat" must not collapse to "heat" and swallow "heating"
    const heat = await type({ service:"heating" });
    if (heat === "Furnace") throw new Error('"heating" was taken by Furnace via "no heat"');
    if (heat !== "Boiler / Radiant Heat") throw new Error('heating -> ' + heat);
  });

  await t('what they wrote is read when the dropdown lands on nothing', async () => {
    const got = await type({ service:"", what:"The hot water tank is leaking all over the floor." });
    if (got !== "Water Heater") throw new Error(got);
  });

  await t('and when the dropdown is something no type claims', async () => {
    const got = await type({ service:"General enquiry",
                             what:"My sump pump has stopped running." });
    if (got !== "Well / Pump") throw new Error(got);
  });

  await t('the dropdown wins over the description when it says something', async () => {
    const got = await type({ service:"Water Heater",
                             what:"Also the drain in the basement is backed up and slow." });
    if (got !== "Water Heater") throw new Error('the description overrode a deliberate pick: ' + got);
  });

  await t('a description that suits two types is left as Other, not guessed', async () => {
    const got = await type({ service:"",
      what:"There is a blocked drain upstairs and the sump pump is dead as well." });
    if (got !== "Other") throw new Error('picked ' + got + ' out of an ambiguous description');
  });

  await t('loose overlap is not applied to a paragraph', async () => {
    // "water" appears, but no trigger phrase and no type name is said
    const got = await type({ service:"",
      what:"There is water on the floor by the back door after it rains." });
    if (got !== "Other") throw new Error(got);
  });

  await t('a type name said in the description counts even with no trigger word', async () => {
    const got = await type({ service:"", what:"I need a backflow test done for the city." });
    if (got !== "Backflow Test") throw new Error(got);
  });

  await t('he can add his own words and they take effect at once', async () => {
    await pg.evaluate(() => { closeModal && closeModal(); openTypeSetup(); });
    await pg.waitForTimeout(350);
    const i = await pg.evaluate(() => TypeEdit.findIndex(t => t.orig === "Leak Repair"));
    const now = await pg.$eval(`[data-type-alias="${i}"]`, el => el.value);
    await pg.fill(`[data-type-alias="${i}"]`, now + ", pipe pissing everywhere");
    await pg.click('[data-save-types]'); await pg.waitForTimeout(400);
    const got = await type({ service:"pipe pissing everywhere" });
    if (got !== "Leak Repair") throw new Error(got);
  });

  await t('his words survive a rename of the type', async () => {
    await pg.evaluate(() => { closeModal && closeModal(); openTypeSetup(); });
    await pg.waitForTimeout(350);
    const i = await pg.evaluate(() => TypeEdit.findIndex(t => t.orig === "Leak Repair"));
    await pg.fill(`[data-type-name="${i}"]`, "Leaks & Service");
    await pg.click('[data-save-types]'); await pg.waitForTimeout(400);
    const r = await pg.evaluate(() => ({
      words: Store.typeAliases("Leaks & Service"),
      gone:  Store.typeAliases("Leak Repair") }));
    if (!r.words.includes("pipe pissing everywhere")) throw new Error(JSON.stringify(r));
    if (r.gone.length) throw new Error('old name still holds words');
    if (await type({ service:"plumbing - leaks" }) !== "Leaks & Service")
      throw new Error('matching broke after the rename');
  });

  await t('"Other" has no words box — it is where things land, not a category', async () => {
    await pg.evaluate(() => { closeModal && closeModal(); openTypeSetup(); });
    await pg.waitForTimeout(350);
    const has = await pg.evaluate(() => {
      const i = Store.jobTypes().indexOf("Other");
      return !!document.querySelector(`[data-type-alias="${i}"]`); });
    if (has) throw new Error('Other has a trigger-words box');
    await pg.evaluate(() => { TypeEdit = null; closeModal(); });
  });

  await t('the words survive a reload', async () => {
    await pg.reload(); await pg.waitForTimeout(600);
    const got = await type({ service:"pipe pissing everywhere" });
    if (got !== "Leaks & Service") throw new Error(got);
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
