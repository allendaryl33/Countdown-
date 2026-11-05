/* Telling her you're on your way to a quote visit.

   The visit is a real appointment with somebody expecting him, but messaging
   was written for jobs and estimates never had it. He booked Chelsea in,
   went looking for "on my way", and there was no button. That gap was made
   the moment estimates got a visit and nothing came with it.

   Both now go through one set of templates rather than two that drift. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1400,height:950} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error' && !/Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  /* Chelsea: a lead with a phone, no customer record, a visit booked. */
  const eid = await pg.evaluate(() => {
    const lead = { id: uid("lead"), at: Date.now(), source:"website", status:"open",
      name:"Chelsea Mowat", phone:"7805550177", email:"c@example.com",
      address:"9915 Saskatchewan Dr", service:"shower is leaking downstairs",
      what:"water on the ceiling below the ensuite", photos:[] };
    Store.data.leads = Store.data.leads || [];
    Store.data.leads.push(lead);
    const e = Store.estimateFromLead(lead);
    Store.setVisit(e, todayStr(), "2:00–4:00", null);
    Store.save();
    return e.id;
  });
  const open = async () => { await pg.evaluate(i => openEstimate(i), eid); await pg.waitForTimeout(400); };
  const sheet = () => pg.evaluate(() => (document.querySelector('#modal-root')||{}).innerText || '');
  // the message itself is a textarea value, which innerText does not carry
  const msgBody = () => pg.evaluate(() => (document.querySelector('#msg-body')||{}).value || '');

  await t('a booked visit offers a way to message her', async () => {
    await open();
    const there = await pg.evaluate(i => !!document.querySelector(`[data-message="${i}"]`), eid);
    if (!there) throw new Error('no message button on an estimate with a visit booked');
  });

  await t('an unbooked one does not, because there is nothing to be on the way to', async () => {
    await pg.evaluate(i => { Store.setVisit(Store.estimate(i), null, "Anytime", null); openEstimate(i); }, eid);
    await pg.waitForTimeout(400);
    const there = await pg.evaluate(i => !!document.querySelector(`[data-message="${i}"]`), eid);
    if (there) throw new Error('offered to say he is on his way to nothing');
    await pg.evaluate(i => { Store.setVisit(Store.estimate(i), todayStr(), "2:00–4:00", null); }, eid);
  });

  await t('it opens on "On my way", with her name and the estimate on it', async () => {
    await open();
    await pg.click(`[data-message="${eid}"]`); await pg.waitForTimeout(450);
    const s = await sheet();
    if (!/Chelsea/.test(s)) throw new Error('her name is not on it: ' + s.slice(0,160));
    if (!/EST-/.test(s)) throw new Error('it does not say which estimate: ' + s.slice(0,160));
    const body = await msgBody();
    if (!/Heading your way/.test(body)) throw new Error('not the on-my-way message: ' + body);
  });

  await t('the message reads properly for a lead who is not a customer yet', async () => {
    const body = await pg.evaluate(i =>
      Store.renderMessage("onway", Store.estimate(i), 0), eid);
    if (!/Hi Chelsea/.test(body)) throw new Error('got: ' + body);
    if (/\{\{/.test(body)) throw new Error('a placeholder went out unfilled: ' + body);
  });

  await t('running late works too, and the extra minutes land in it', async () => {
    const plain = await pg.evaluate(i => Store.renderMessage("late", Store.estimate(i), 0), eid);
    const bumped = await pg.evaluate(i => Store.renderMessage("late", Store.estimate(i), 30), eid);
    if (!/Running behind/.test(plain)) throw new Error('got: ' + plain);
    if (plain === bumped) throw new Error('adding 30 minutes changed nothing: ' + bumped);
  });

  await t('the booked message names the day and the slot she was given', async () => {
    const body = await pg.evaluate(i => Store.renderMessage("confirm", Store.estimate(i), 0), eid);
    if (/\{\{/.test(body)) throw new Error('unfilled placeholder: ' + body);
    if (!/booked in for/i.test(body)) throw new Error('got: ' + body);
    if (!/2/.test(body)) throw new Error('the time slot is missing: ' + body);
  });

  await t('"Finished" is never offered before a quote', async () => {
    const tabs = await pg.evaluate(() =>
      Array.from(document.querySelectorAll('[data-msg-tpl]')).map(b => b.dataset.msgTpl));
    if (tabs.includes("done"))
      throw new Error('offered to tell her the work is finished: ' + tabs.join(","));
    if (!tabs.includes("onway") || !tabs.includes("late"))
      throw new Error('the ones he needs are missing: ' + tabs.join(","));
  });

  await t('what he sent is written on the estimate, not lost', async () => {
    await pg.evaluate(() => { MsgState.asking = "text"; finishSend(); });
    await pg.waitForTimeout(400);
    const log = await pg.evaluate(i => (Store.estimate(i).log||[]).map(l=>l.text||l).join(' | '), eid);
    if (!/Texted customer: On my way/i.test(log))
      throw new Error('the estimate log says nothing about it: ' + log);
  });

  await t('messaging from a job is untouched', async () => {
    const r = await pg.evaluate(() => {
      const j = Store.data.jobs.find(x => Store.customer(x.customerId));
      j.scheduledDate = todayStr(); j.window = "8:00–10:00"; Store.save();
      closeModal(); openMessage(j.id, "onway");
      return { id: j.id, no: j.no,
               text: (document.querySelector('#modal-root')||{}).innerText || '' };
    });
    await pg.waitForTimeout(350);
    const s = await sheet();
    if (!/job #/.test(s)) throw new Error('a job no longer says it is a job: ' + s.slice(0,160));
    const body = await msgBody();
    if (!/Heading your way/.test(body)) throw new Error('the job message broke: ' + body);
    const tabs = await pg.evaluate(() =>
      Array.from(document.querySelectorAll('[data-msg-tpl]')).map(b => b.dataset.msgTpl));
    if (!tabs.includes("done")) throw new Error('a job lost its Finished message');
  });

  await b.close();
  if (errs.length){
    console.log('\n' + errs.length + ' problem(s)');
    errs.forEach(e => console.log('  - ' + e));
    process.exit(1);
  }
  console.log('\nall good');
})();
