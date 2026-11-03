/* Deanna's inquiry said plumbing / leaks. The text that went out to her said
   "here's the estimate for the drain cleaning", because an unmatched service
   fell through to JOB_TYPES[0] and that happens to be Drain Cleaning. */
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

  const type = s => pg.evaluate(v => Store.leadJobType({ service:v }), s);

  await t("Deanna's wording lands on Leak Repair, not Drain Cleaning", async () => {
    for (const s of ["Plumbing - leaks","plumbing / leaks","Leaks","leak"]) {
      const got = await type(s);
      if (got !== "Leak Repair") throw new Error(s + ' -> ' + got);
    }
  });

  await t('plurals and -ing endings still find their type', async () => {
    const want = { "drains":"Drain Cleaning", "blocked drain":"Drain Cleaning",
      "heating":"Boiler / Radiant Heat", "frozen pipes":"Frozen Pipe",
      "backflow testing":"Backflow Test", "gas fitting":"Gas Line",
      "hot water tank":"Water Heater", "sewer backup":"Sewer / Camera",
      "furnace quit":"Furnace", "toilet install":"Fixture Install" };
    for (const [s,exp] of Object.entries(want)) {
      const got = await type(s);
      if (got !== exp) throw new Error(s + ' -> ' + got + ', wanted ' + exp);
    }
  });

  await t('an exact job type is returned as itself', async () => {
    const all = await pg.evaluate(() => JOB_TYPES.map(t => [t, Store.leadJobType({ service:t })]));
    const bad = all.filter(([a,b]) => a !== b);
    if (bad.length) throw new Error(JSON.stringify(bad));
  });

  await t('what it cannot place is Other, never a confident wrong guess', async () => {
    for (const s of ["", null, undefined, "something odd", "general enquiry",
                     "a b", "need a quote", "xyzzy"]) {
      const got = await type(s);
      if (got !== "Other") throw new Error(JSON.stringify(s) + ' -> ' + got);
    }
  });

  await t('Other never reaches the customer as the word "other"', async () => {
    const r = await pg.evaluate(() => [
      Store.workPhrase("Other"), Store.workPhrase(""), Store.workPhrase(null),
      Store.workPhrase("Leak Repair"), Store.workPhrase("Boiler / Radiant Heat"),
      Store.workPhrase("Sewer / Camera")]);
    const exp = ["work you asked about","work you asked about","work you asked about",
                 "leak repair","boiler","sewer"];
    if (JSON.stringify(r) !== JSON.stringify(exp)) throw new Error(JSON.stringify(r));
  });

  await t('the estimate text reads right for a placed type and an unplaced one', async () => {
    const out = await pg.evaluate(() => {
      const e = Store.data.estimates.find(x => (x.items||[]).length);
      const c = { name:"Deanna Reid", phone:"780-555-0101" };
      const got = {};
      for (const ty of ["Leak Repair","Other","Boiler / Radiant Heat"]) {
        e.type = ty;
        got[ty] = Store.estimateEmailBody
          ? Store.estimateEmailBody(e, c)
          : "the estimate for the " + Store.workPhrase(e.type);
      }
      return got;
    });
    if (!out["Leak Repair"].includes("for the leak repair")) throw new Error(out["Leak Repair"]);
    if (!out["Other"].includes("for the work you asked about")) throw new Error(out["Other"]);
    if (out["Other"].includes("for the other")) throw new Error('says "the other"');
    if (!out["Boiler / Radiant Heat"].includes("for the boiler")) throw new Error(out["Boiler / Radiant Heat"]);
  });

  await t('a booking confirmation reads right too', async () => {
    const s = await pg.evaluate(() => {
      const j = Store.data.jobs[0]; j.type = "Other";
      const tpl = (Store.data.settings.messages||[]).find(t => (t.body||"").includes("{{work}}"));
      if (!tpl) throw new Error('no template uses {{work}}');
      return Store.renderMessage(tpl.id, j);
    });
    if (s && !s.includes("for the work you asked about")) throw new Error(s);
  });

  await t('a lead booked in from the form carries the matched type', async () => {
    const got = await pg.evaluate(() => {
      const l = { name:"Deanna Reid", phone:"780-555-0101", service:"Plumbing - leaks" };
      return Store.leadJobType(l);
    });
    if (got !== "Leak Repair") throw new Error(got);
  });

  await t('the notes keep what they ticked on the form, alongside their own words', async () => {
    const r = await pg.evaluate(() => ({
      both: Store.leadStory({ what:"Shower leaks into the ceiling below.",
                              service:"Plumbing - leaks", timing:"weekday mornings" }),
      only: Store.leadStory({ service:"Plumbing - leaks" }),
      none: Store.leadStory({})
    }));
    if (!r.both.includes("Shower leaks into the ceiling below.")) throw new Error(r.both);
    if (!r.both.includes("Picked on the form: Plumbing - leaks.")) throw new Error(r.both);
    if (!r.only.includes("Plumbing - leaks")) throw new Error(r.only);
    if (!r.none.includes("no detail given")) throw new Error(r.none);
  });

  await t('their own words carry an unplaceable job, instead of "the other"', async () => {
    const r = await pg.evaluate(() => [
      Store.workPhrase("Other", "shower rebuild"),
      Store.workPhrase("Other", "Plumbing - leaks"),
      Store.workPhrase("", "bathroom reno"),
      Store.workPhrase("Other", ""),
      Store.workPhrase("Leak Repair", "shower rebuild")]);
    const exp = ["shower rebuild","plumbing leaks","bathroom reno",
                 "work you asked about","leak repair"];
    if (JSON.stringify(r) !== JSON.stringify(exp)) throw new Error(JSON.stringify(r));
  });

  await t('an estimate and the job off it both keep the form wording', async () => {
    const r = await pg.evaluate(() => {
      const l = { id:"lead-jt", source:"website", name:"Deanna Reid",
                  phone:"780-555-0199", email:"d2@example.com", address:"9 Elm",
                  service:"Xyzzy job", what:"", timing:"", photos:[] };
      Store.data.leads.push(l);
      const e = Store.estimateFromLead(l);
      e.items = [{ desc:"Rebuild shower", kind:"labor", qty:1, price:8500 }];
      const j = Store.convertEstimate(e, { customerId: Store.customerFromEstimate(e).id });
      return { etype:e.type, esvc:e.service, jtype:j.type, jsvc:j.service,
               phrase: Store.workPhrase(j.type, j.service),
               notes: e.description };
    });
    if (r.etype !== "Other") throw new Error('estimate type ' + r.etype);
    if (r.esvc !== "Xyzzy job" || r.jsvc !== "Xyzzy job") throw new Error(JSON.stringify(r));
    if (r.phrase !== "xyzzy job") throw new Error(r.phrase);
    if (!r.notes.includes("Picked on the form: Xyzzy job.")) throw new Error(r.notes);
  });

  await t('older records get the wording back off their lead on load', async () => {
    const r = await pg.evaluate(() => {
      Store.data.leads.push({ id:"lead-old", source:"website", name:"Old One",
        phone:"780-555-0177", service:"Plumbing - leaks", photos:[] });
      Store.data.jobs.push({ id:"job-old", no:1, fromLead:"lead-old", type:"Other",
        parts:[], materials:[], timeEntries:[], payment:blankPayment(), status:"new" });
      Store.backfill();
      const j = Store.data.jobs.find(x => x.id === "job-old");
      return { svc:j.service, phrase: Store.workPhrase(j.type, j.service) };
    });
    if (r.svc !== "Plumbing - leaks") throw new Error(JSON.stringify(r));
    if (r.phrase !== "plumbing leaks") throw new Error(r.phrase);
  });

  await t('backfill never overwrites wording already on a record', async () => {
    const got = await pg.evaluate(() => {
      const j = Store.data.jobs.find(x => x.id === "job-old");
      j.service = "What he typed himself";
      Store.backfill();
      return Store.data.jobs.find(x => x.id === "job-old").service;
    });
    if (got !== "What he typed himself") throw new Error(got);
  });

  await t('the invoice heading never reads "Other"', async () => {
    const r = await pg.evaluate(() => [
      Store.workLabel("Leak Repair", ""),
      Store.workLabel("Other", "shower rebuild"),
      Store.workLabel("Other", ""),
      Store.workLabel("", "")]);
    const exp = ["Leak Repair","Shower rebuild","Service call","Service call"];
    if (JSON.stringify(r) !== JSON.stringify(exp)) throw new Error(JSON.stringify(r));
  });

  await b.close();
  if (errs.length) { console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
