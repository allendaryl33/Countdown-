/* The signing link had its own copy of the "it says sent when it wasn't" bug.
   The customer-messages sheet was fixed for it; this path was missed, so
   backing out of Messages still moved an estimate from draft to sent. */
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

  /* No cloud here, so the real send path bails early. Drive the panel the way
     a tap does and assert on what gets written down, which is the bug. */
  const eid = await pg.evaluate(() => {
    const e = Store.data.estimates.find(x => (x.items||[]).length) || Store.data.estimates[0];
    e.status = "draft"; delete e.approval; delete e.linkSentAt;
    Store.data.settings.pendingLink = null;
    Store.save(); return e.id;
  });
  const st = () => pg.evaluate(id => ({
    status: Store.estimate(id).status,
    sentAt: Store.estimate(id).linkSentAt || null,
    pending: Store.data.settings.pendingLink || null }), eid);

  await t('it starts as a draft that has never been sent', async () => {
    const r = await st();
    if (r.status !== "draft" || r.sentAt) throw new Error(JSON.stringify(r));
  });

  await t('handing the link to the phone records nothing on its own', async () => {
    await pg.evaluate(id => beginLinkSend(id, "Texted"), eid);
    await pg.waitForTimeout(300);
    const r = await st();
    if (r.status !== "draft") throw new Error('moved to ' + r.status + ' without being sent');
    if (r.sentAt) throw new Error('stamped as sent before he said so');
    if (!r.pending) throw new Error('the question was not remembered');
  });

  await t('backing out leaves it a draft, with nothing written down', async () => {
    await pg.evaluate(() => finishLinkSend(false));
    await pg.waitForTimeout(300);
    const r = await st();
    if (r.status !== "draft") throw new Error('backing out still moved it to ' + r.status);
    if (r.sentAt) throw new Error('backing out stamped it as sent');
    if (r.pending) throw new Error('left a question hanging');
  });

  await t('saying it went is what moves it to sent', async () => {
    await pg.evaluate(id => beginLinkSend(id, "Texted"), eid);
    await pg.waitForTimeout(250);
    await pg.evaluate(() => finishLinkSend(true));
    await pg.waitForTimeout(300);
    const r = await st();
    if (r.status !== "sent") throw new Error('still ' + r.status);
    if (!r.sentAt) throw new Error('no send stamp');
    if (r.pending) throw new Error('left a question hanging');
  });

  await t('the estimate log says it went, and only once', async () => {
    const n = await pg.evaluate(id =>
      (Store.estimate(id).log || []).filter(l => /signing link/i.test(l.text)).length, eid);
    if (n !== 1) throw new Error(n + ' log entries, wanted 1');
  });

  await t('copying the link asks too, rather than assuming', async () => {
    const e2 = await pg.evaluate(() => {
      const e = Store.data.estimates.filter(x => (x.items||[]).length)[1]
             || Store.data.estimates[1];
      e.status = "draft"; delete e.linkSentAt; Store.save(); return e.id;
    });
    if (!e2) { console.log('       (no second estimate)'); return; }
    await pg.evaluate(id => beginLinkSend(id, "Copied"), e2);
    await pg.waitForTimeout(250);
    const mid = await pg.evaluate(id => Store.estimate(id).status, e2);
    if (mid !== "draft") throw new Error('copying marked it ' + mid);
    await pg.evaluate(() => finishLinkSend(true));
    await pg.waitForTimeout(250);
    const after = await pg.evaluate(id => Store.estimate(id).status, e2);
    if (after !== "sent") throw new Error('saying yes after a copy left it ' + after);
  });

  await t('the question survives the app being dropped while Messages is up', async () => {
    await pg.evaluate(id => {
      const e = Store.estimate(id);
      e.status = "draft"; delete e.linkSentAt; Store.save();
      beginLinkSend(id, "Texted");
    }, eid);
    await pg.waitForTimeout(250);
    await pg.reload(); await pg.waitForTimeout(700);
    const r = await pg.evaluate(id => ({
      pending: Store.data.settings.pendingLink || null,
      status: Store.estimate(id).status }), eid);
    if (!r.pending) throw new Error('the question was lost with the page');
    if (r.status !== "draft") throw new Error('it was marked sent across the reload');
  });

  await t('a re-send of an already-sent estimate still asks', async () => {
    await pg.evaluate(id => {
      Store.data.settings.pendingLink = null;
      const e = Store.estimate(id); e.status = "sent"; e.linkSentAt = 1; Store.save();
      beginLinkSend(id, "Texted");
    }, eid);
    await pg.waitForTimeout(250);
    const before = await pg.evaluate(id => Store.estimate(id).linkSentAt, eid);
    if (before !== 1) throw new Error('re-stamped before he answered');
    await pg.evaluate(() => finishLinkSend(false));
    await pg.waitForTimeout(250);
    const after = await pg.evaluate(id => Store.estimate(id).linkSentAt, eid);
    if (after !== 1) throw new Error('backing out of a re-send still re-stamped it');
  });

  /* The redraw used to call sendForSignature again, which publishes a token
     every time it runs — so each tap of Text minted another live link. */
  await t('asking the question does not mint another live link', async () => {
    const r = await pg.evaluate(id => {
      const e = Store.estimate(id);
      e.status = "draft"; delete e.linkSentAt;
      Store.data.settings.pendingLink = null; Store.save();
      const before = (Cloud.signLinks || []).length;
      beginLinkSend(id, "Texted");
      beginLinkSend(id, "Texted");
      beginLinkSend(id, "Texted");
      return { before, after: (Cloud.signLinks || []).length };
    }, eid);
    if (r.after !== r.before)
      throw new Error(`three taps made ${r.after - r.before} extra signing link(s)`);
    await pg.evaluate(() => finishLinkSend(false));
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
