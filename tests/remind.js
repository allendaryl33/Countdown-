/* The night-before nudge. The push itself comes from Supabase and can't be
   tested here; this is the phone's half — who gets asked about, what the
   message says, and that confirming one stops it nagging. */
/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:430,height:1000} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(500);

  // one job tomorrow for a reachable customer, nothing else on that day
  const jid = await pg.evaluate(() => {
    const d = Store.remindDate();
    Store.data.jobs.forEach(j => { if (j.scheduledDate === d) j.scheduledDate = "2020-01-01"; });
    const c = Store.data.customers.find(x => x.phone);
    const j = Store.data.jobs[0];
    j.customerId = c.id; j.scheduledDate = d; j.status = "new";
    j.type = "Leak Repair"; delete j.reminded;
    Store.save(); return j.id;
  });

  const strip = () => pg.evaluate(() => {
    const el = [...document.querySelectorAll('#view .card')]
      .find(c => /not confirmed yet/.test(c.textContent));
    return el ? el.textContent.replace(/\s+/g,' ').trim() : null;
  });
  const home = async () => { await pg.evaluate(() => go("today")); await pg.waitForTimeout(400); };

  await t('tomorrow\'s unconfirmed job shows on Today', async () => {
    await home();
    const s = await strip();
    if (!s) throw new Error('no strip');
    if (!/1 job tomorrow not confirmed yet/.test(s)) throw new Error(s);
  });

  await t('a job today is not asked about — only tomorrow', async () => {
    await pg.evaluate(id => { Store.job(id).scheduledDate = todayStr(); Store.save(); }, jid);
    await home();
    if (await strip()) throw new Error('today\'s job was listed as tomorrow\'s');
    await pg.evaluate(id => { Store.job(id).scheduledDate = Store.remindDate(); Store.save(); }, jid);
  });

  await t('a cancelled job is not chased', async () => {
    await pg.evaluate(id => { Store.job(id).status = "cancelled"; Store.save(); }, jid);
    await home();
    if (await strip()) throw new Error('cancelled job still listed');
    await pg.evaluate(id => { Store.job(id).status = "new"; Store.save(); }, jid);
  });

  await t('a customer with no phone is not chased — there is nothing to send', async () => {
    const keep = await pg.evaluate(id => {
      const c = Store.customer(Store.job(id).customerId); const p = c.phone; c.phone = "";
      Store.save(); return p; }, jid);
    await home();
    if (await strip()) throw new Error('listed a customer with no number');
    await pg.evaluate(([id,p]) => { Store.customer(Store.job(id).customerId).phone = p; Store.save(); },
                      [jid, keep]);
  });

  await t('the message reads like a confirmation and names the day', async () => {
    const txt = await pg.evaluate(id => Store.renderMessage("reminder", Store.job(id)), jid);
    if (!/tomorrow/.test(txt)) throw new Error(txt);
    if (!/confirm/i.test(txt)) throw new Error(txt);
    if (/\{\{/.test(txt)) throw new Error('unfilled field: ' + txt);
  });

  await t('Confirm opens the sheet on the reminder, ready to text', async () => {
    await home();
    await pg.click(`[data-message="${jid}:reminder"]`); await pg.waitForTimeout(450);
    const r = await pg.evaluate(() => ({
      tpl: MsgState.tplId,
      href: (document.querySelector('#msg-sms')||{}).getAttribute
            ? document.querySelector('#msg-sms').getAttribute('href') : null }));
    if (r.tpl !== "reminder") throw new Error('sheet opened on ' + r.tpl);
    if (!r.href || !r.href.startsWith("sms:")) throw new Error('not an sms link: ' + r.href);
    if (!/tomorrow/.test(decodeURIComponent(r.href))) throw new Error(r.href);
  });

  await t('tapping Text records nothing on its own — it only asks', async () => {
    await pg.click('#msg-sms'); await pg.waitForTimeout(400);
    const r = await pg.evaluate(id => ({
      asking: MsgState.asking,
      pending: !!Store.data.settings.pendingSend,
      question: !!document.querySelector('[data-msg-went="yes"]'),
      reminded: Store.job(id).reminded || null }), jid);
    if (r.asking !== "text") throw new Error('not asking: ' + r.asking);
    if (!r.pending || !r.question) throw new Error(JSON.stringify(r));
    if (r.reminded) throw new Error('marked confirmed just for opening Messages');
  });

  /* Headless chromium stops delivering clicks to the page once an sms: link
     has been followed, so the answer is exercised through Copy — the same
     beginSend/finishSend path, minus the navigation. On the phone the page
     stays live while Messages is in front. */
  await t('answering yes is what records it, and stops the nagging', async () => {
    await pg.reload(); await pg.waitForTimeout(600);
    // the reload re-asks the unanswered question from the previous test;
    // clear it and shut the sheet so the overlay stops eating clicks
    await pg.evaluate(() => {
      Store.data.settings.pendingSend = null; Store.save();
      if (typeof closeModal === "function") closeModal();
    });
    await home();
    await pg.click(`[data-message="${jid}:reminder"]`); await pg.waitForTimeout(400);
    await pg.click('[data-msg-send="copy"]'); await pg.waitForTimeout(400);
    if (!await pg.evaluate(() => !!document.querySelector('[data-msg-went="yes"]')))
      throw new Error('copy did not ask');
    await pg.click('[data-msg-went="yes"]'); await pg.waitForTimeout(400);
    await home();
    if (await strip()) throw new Error('still asking after it was sent');
    const r = await pg.evaluate(id => ({ rem: Store.job(id).reminded,
                                         pending: Store.data.settings.pendingSend }), jid);
    if (!r.rem) throw new Error('nothing recorded');
    if (r.pending) throw new Error('left a question hanging');
  });

  await t('a job further out is not chased yet', async () => {
    await pg.evaluate(id => { Store.job(id).scheduledDate = addDays(todayStr(), 2); Store.save(); }, jid);
    await home();
    if (await strip()) throw new Error('two days out should not be chased yet');
  });

  await t('confirmed for one day then moved to another is chased again', async () => {
    // they were told a date that is no longer the date, so the stamp is stale
    await pg.evaluate(id => {
      const j = Store.job(id);
      j.scheduledDate = Store.remindDate();
      j.reminded = { at: Date.now() - 86400000, forDate: addDays(todayStr(), 4), how:"Texted" };
      Store.save();
    }, jid);
    await home();
    if (!await strip()) throw new Error('they were told the wrong day and nobody was asked');
  });

  await t('and once re-confirmed for the new day it goes quiet', async () => {
    await pg.click(`[data-message="${jid}:reminder"]`); await pg.waitForTimeout(400);
    await pg.click('[data-msg-send="copy"]'); await pg.waitForTimeout(400);
    await pg.click('[data-msg-went="yes"]'); await pg.waitForTimeout(400);
    await home();
    if (await strip()) throw new Error('still chasing after the re-confirm');
  });

  await t('the reminder template survived being added to an existing shop', async () => {
    const ids = await pg.evaluate(() => Store.messages().map(m => m.id));
    if (!ids.includes("reminder")) throw new Error(JSON.stringify(ids));
    if (ids.length !== new Set(ids).size) throw new Error('duplicated: ' + JSON.stringify(ids));
  });

  await t('backfill does not overwrite wording he has edited', async () => {
    const kept = await pg.evaluate(() => {
      const m = Store.data.settings.messages.find(x => x.id === "reminder");
      m.body = "My own words {{first_name}}";
      Store.save(); Store.backfill();
      return Store.data.settings.messages.find(x => x.id === "reminder").body; });
    if (kept !== "My own words {{first_name}}") throw new Error(kept);
  });

  await t('the buzz is off until he turns it on, and says why on a desktop', async () => {
    const r = await pg.evaluate(async () => ({
      state: Nudge.state(), installed: Nudge.installed(),
      res: await Nudge.enable() }));
    if (r.state !== "off" && r.state !== "unsupported") throw new Error(r.state);
    if (r.res.ok) throw new Error('claimed success with no home-screen app');
    if (!r.res.why) throw new Error('refused without saying why');
  });

  await t('the settings card is there and offers to turn it on', async () => {
    await pg.evaluate(() => go("data")); await pg.waitForTimeout(500);
    const has = await pg.evaluate(() =>
      !!document.querySelector('[data-action="nudge-on"], [data-action="nudge-off"]') ||
      /can't do notifications/.test(document.querySelector('#view').textContent));
    if (!has) throw new Error('no reminder card in Data & Setup');
  });

  await t('backing out records nothing at all', async () => {
    await pg.evaluate(id => {
      const j = Store.job(id); j.scheduledDate = Store.remindDate(); delete j.reminded;
      Store.data.settings.pendingSend = null; Store.save();
    }, jid);
    await home();
    if (!await strip()) throw new Error('setup: nothing to confirm');
    // the job already carries real sends from the tests above, so compare
    // against where the log stood rather than expecting it to be empty
    const before = await pg.evaluate(id => (Store.job(id).log || []).length, jid);

    await pg.click(`[data-message="${jid}:reminder"]`); await pg.waitForTimeout(400);
    await pg.click('[data-msg-send="copy"]'); await pg.waitForTimeout(400);
    await pg.click('[data-msg-went="no"]'); await pg.waitForTimeout(400);
    await pg.evaluate(() => closeModal && closeModal());
    await home();

    const r = await pg.evaluate(id => ({
      reminded: Store.job(id).reminded || null,
      pending: Store.data.settings.pendingSend || null,
      logged: (Store.job(id).log || []).length }), jid);
    if (r.reminded) throw new Error('marked confirmed after backing out');
    if (r.pending) throw new Error('left a question hanging');
    if (r.logged !== before)
      throw new Error('wrote a log entry for a message he did not send');
    if (!await strip()) throw new Error('stopped asking even though nothing was sent');
  });

  await t('the question survives the app being dropped while Messages is up', async () => {
    await pg.click(`[data-message="${jid}:reminder"]`); await pg.waitForTimeout(400);
    await pg.click('#msg-sms'); await pg.waitForTimeout(400);
    await pg.reload(); await pg.waitForTimeout(800);          // iOS evicting the page
    const asked = await pg.evaluate(() => !!document.querySelector('[data-msg-went="yes"]'));
    if (!asked) throw new Error('the question was lost with the page');
    await pg.click('[data-msg-went="yes"]'); await pg.waitForTimeout(500);
    const r = await pg.evaluate(id => Store.job(id).reminded, jid);
    if (!r) throw new Error('answering yes after the reload did not record it');
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
