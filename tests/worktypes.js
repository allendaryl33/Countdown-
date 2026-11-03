/* He curates the work types himself. The trade he does changes, and he
   should not have to come to me to add "Shower & Tub". */
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

  const openEditor = async () => {
    await pg.evaluate(() => { closeModal && closeModal(); openTypeSetup(); });
    await pg.waitForTimeout(300);
  };

  await t('the editor opens from Data & Setup and lists every type', async () => {
    await pg.evaluate(() => go("data")); await pg.waitForTimeout(500);
    const btn = await pg.$('[data-action="edit-types"]');
    if (!btn) throw new Error('no button in Data & Setup');
    await btn.click(); await pg.waitForTimeout(400);
    const rows = await pg.$$eval('[data-type-name]', n => n.length);
    const want = await pg.evaluate(() => Store.jobTypes().length);
    if (rows !== want) throw new Error(rows + ' rows for ' + want + ' types');
  });

  await t('"Other" cannot be renamed or removed', async () => {
    await openEditor();
    const r = await pg.evaluate(() => {
      const i = Store.jobTypes().indexOf("Other");
      return { nameDisabled: document.querySelector(`[data-type-name="${i}"]`).disabled,
               delDisabled:  document.querySelector(`[data-type-del="${i}"]`).disabled };
    });
    if (!r.nameDisabled || !r.delDisabled) throw new Error(JSON.stringify(r));
  });

  await t('he can add a type and it shows up on a job', async () => {
    await openEditor();
    await pg.click('[data-type-add]'); await pg.waitForTimeout(250);
    const i = await pg.evaluate(() => TypeEdit.length - 2);   // new row sits above Other
    await pg.fill(`[data-type-name="${i}"]`, "Shower & Tub");
    await pg.click('[data-save-types]'); await pg.waitForTimeout(400);
    const list = await pg.evaluate(() => Store.jobTypes());
    if (!list.includes("Shower & Tub")) throw new Error(JSON.stringify(list));
    if (list[list.length-1] !== "Other") throw new Error('Other is not last: ' + JSON.stringify(list));
  });

  await t('a new type is matched against a website inquiry', async () => {
    const got = await pg.evaluate(() => Store.leadJobType({ service:"shower and tub" }));
    if (got !== "Shower & Tub") throw new Error(got);
  });

  await t('a trigger word already on another type keeps it, until he moves it', async () => {
    // "shower rebuild" ships as a Remodel Rough-in word. Adding a type whose
    // name merely overlaps must not quietly steal it — his word is the
    // deliberate answer, the name overlap is a guess.
    let got = await pg.evaluate(() => Store.leadJobType({ service:"shower rebuild" }));
    if (got !== "Remodel Rough-in") throw new Error('before the move: ' + got);

    await openEditor();
    const from = await pg.evaluate(() => TypeEdit.findIndex(t => t.orig === "Remodel Rough-in"));
    const cur = await pg.$eval(`[data-type-alias="${from}"]`, el => el.value);
    await pg.fill(`[data-type-alias="${from}"]`,
      cur.split(",").map(x => x.trim()).filter(x => x && x !== "shower rebuild").join(", "));
    const to = await pg.evaluate(() => TypeEdit.findIndex(t => t.orig === "Shower & Tub"));
    await pg.fill(`[data-type-alias="${to}"]`, "shower rebuild, tub surround");
    await pg.click('[data-save-types]'); await pg.waitForTimeout(400);

    got = await pg.evaluate(() => Store.leadJobType({ service:"shower rebuild" }));
    if (got !== "Shower & Tub") throw new Error('after the move: ' + got);
  });

  await t('renaming a type brings its jobs and estimates with it', async () => {
    const before = await pg.evaluate(() => {
      const j = Store.data.jobs[0]; j.type = "Shower & Tub";
      const e = Store.data.estimates[0]; e.type = "Shower & Tub";
      Store.save(); return { j:j.id, e:e.id };
    });
    await openEditor();
    const i = await pg.evaluate(() => TypeEdit.findIndex(t => t.orig === "Shower & Tub"));
    await pg.fill(`[data-type-name="${i}"]`, "Bathroom");
    await pg.click('[data-save-types]'); await pg.waitForTimeout(400);
    const r = await pg.evaluate(ids => ({
      list: Store.jobTypes(),
      j: Store.job(ids.j).type, e: Store.estimate(ids.e).type }), before);
    if (r.list.includes("Shower & Tub")) throw new Error('old name still listed');
    if (r.j !== "Bathroom" || r.e !== "Bathroom") throw new Error(JSON.stringify(r));
  });

  await t('a removed type leaves its records alone, and they still open', async () => {
    const id = await pg.evaluate(() => {
      const j = Store.data.jobs[1]; j.type = "Backflow Test"; Store.save(); return j.id; });
    await openEditor();
    pg.once('dialog', d => d.accept());
    const i = await pg.evaluate(() => TypeEdit.findIndex(t => t.orig === "Backflow Test"));
    await pg.click(`[data-type-del="${i}"]`); await pg.waitForTimeout(300);
    await pg.click('[data-save-types]'); await pg.waitForTimeout(400);
    const r = await pg.evaluate(jid => ({
      listed: Store.jobTypes().includes("Backflow Test"),
      kept: Store.job(jid).type,
      offered: Store.typeChoices(Store.job(jid).type).includes("Backflow Test") }), id);
    if (r.listed) throw new Error('still offered for new work');
    if (r.kept !== "Backflow Test") throw new Error('record was retyped: ' + r.kept);
    if (!r.offered) throw new Error('its own record would not offer it back');
  });

  await t('the dropdown on that record does not silently retype it', async () => {
    const id = await pg.evaluate(() => Store.data.jobs[1].id);
    await pg.evaluate(j => { closeModal && closeModal(); openJobForm(j); }, id);
    await pg.waitForTimeout(400);
    const v = await pg.$eval('#f-type', el => el.value);
    if (v !== "Backflow Test") throw new Error('form shows ' + v);
    await pg.evaluate(() => closeModal && closeModal());
  });

  await t('the waiver drawer opens, ticks and saves', async () => {
    await openEditor();
    const i = await pg.evaluate(() => TypeEdit.findIndex(t => t.orig === "Leak Repair"));
    await pg.click(`[data-type-waivers="${i}"]`); await pg.waitForTimeout(300);
    const boxes = await pg.$$(`[data-type-waiver="${i}"]`);
    if (!boxes.length) throw new Error('drawer did not open');
    const key = await pg.evaluate(() => Store.activeTemplates()[0].key);
    await pg.check(`[data-type-waiver="${i}"][value="${key}"]`);
    await pg.click('[data-save-types]'); await pg.waitForTimeout(400);
    const got = await pg.evaluate(() => Store.typeWaivers("Leak Repair"));
    if (!got.includes(key)) throw new Error(JSON.stringify(got));
  });

  await t('opening one drawer does not wipe another type\'s waivers', async () => {
    const before = await pg.evaluate(() => Store.typeWaivers("Drain Cleaning"));
    await openEditor();
    const i = await pg.evaluate(() => TypeEdit.findIndex(t => t.orig === "Water Heater"));
    await pg.click(`[data-type-waivers="${i}"]`); await pg.waitForTimeout(300);
    await pg.click('[data-save-types]'); await pg.waitForTimeout(400);
    const after = await pg.evaluate(() => Store.typeWaivers("Drain Cleaning"));
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(JSON.stringify({before,after}));
  });

  await t('waivers follow a type through a rename', async () => {
    const keysBefore = await pg.evaluate(() => Store.typeWaivers("Drain Cleaning"));
    if (!keysBefore.length) throw new Error('no waivers to start with');
    await openEditor();
    const i = await pg.evaluate(() => TypeEdit.findIndex(t => t.orig === "Drain Cleaning"));
    await pg.fill(`[data-type-name="${i}"]`, "Drains");
    await pg.click('[data-save-types]'); await pg.waitForTimeout(400);
    const after = await pg.evaluate(() => Store.typeWaivers("Drains"));
    if (JSON.stringify(after) !== JSON.stringify(keysBefore)) throw new Error(JSON.stringify(after));
  });

  await t('a suggested waiver still lands on a job of that type', async () => {
    const n = await pg.evaluate(() => {
      const j = Store.data.jobs[0]; j.type = "Drains";
      return Store.recommendedFor(j).length; });
    if (!n) throw new Error('no waiver suggested after the rename');
  });

  await t('two rows typed to the same name collapse to one', async () => {
    await openEditor();
    await pg.click('[data-type-add]'); await pg.waitForTimeout(250);
    const i = await pg.evaluate(() => TypeEdit.length - 2);
    await pg.fill(`[data-type-name="${i}"]`, "drains");
    await pg.click('[data-save-types]'); await pg.waitForTimeout(400);
    const list = await pg.evaluate(() => Store.jobTypes());
    const dupes = list.filter(x => x.toLowerCase() === "drains").length;
    if (dupes !== 1) throw new Error(JSON.stringify(list));
  });

  await t('an empty row is dropped rather than saved as a blank type', async () => {
    await openEditor();
    await pg.click('[data-type-add]'); await pg.waitForTimeout(250);
    await pg.click('[data-save-types]'); await pg.waitForTimeout(400);
    const list = await pg.evaluate(() => Store.jobTypes());
    if (list.some(x => !x.trim())) throw new Error(JSON.stringify(list));
  });

  await t('typing then reordering does not lose what was typed', async () => {
    await openEditor();
    await pg.fill('[data-type-name="0"]', "Renamed First");
    await pg.click('[data-type-move="0"][data-dir="1"]'); await pg.waitForTimeout(300);
    const still = await pg.evaluate(() => TypeEdit.some(t => t.name === "Renamed First"));
    if (!still) throw new Error('the edit was thrown away by the rebuild');
    await pg.evaluate(() => { TypeEdit = null; closeModal(); });
  });

  await t('the list survives a reload', async () => {
    await pg.reload(); await pg.waitForTimeout(600);
    const list = await pg.evaluate(() => Store.jobTypes());
    if (!list.includes("Bathroom") || !list.includes("Drains")) throw new Error(JSON.stringify(list));
    if (list[list.length-1] !== "Other") throw new Error('Other not last');
  });

  await t('going live keeps the list he curated', async () => {
    const r = await pg.evaluate(() => {
      const before = Store.jobTypes();
      const waivers = Store.typeWaivers("Drains");
      Store.goLive({ company:"Poseidon Plumbing & Gasfitting Ltd.", phone:"780-555-0100",
                     laborRate:140, startJobNo:1000, techName:"Daryl" });
      return { before, after: Store.jobTypes(),
               wBefore: waivers, wAfter: Store.typeWaivers("Drains"),
               jobs: Store.data.jobs.length };
    });
    if (JSON.stringify(r.after) !== JSON.stringify(r.before))
      throw new Error('list changed: ' + JSON.stringify(r));
    if (JSON.stringify(r.wAfter) !== JSON.stringify(r.wBefore))
      throw new Error('waivers lost: ' + JSON.stringify(r));
    if (r.jobs !== 0) throw new Error('go-live did not clear the jobs');
  });

  await t('and the curated list is still there after that reload', async () => {
    await pg.reload(); await pg.waitForTimeout(600);
    const list = await pg.evaluate(() => Store.jobTypes());
    if (!list.includes("Drains") || !list.includes("Bathroom")) throw new Error(JSON.stringify(list));
    if (list[list.length-1] !== "Other") throw new Error('Other not last');
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
