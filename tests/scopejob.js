/* The change-of-scope flow as he actually does it: open the job, hit Change
   of scope, quote the extra, and when she approves it the new job comes out
   already on the original invoice. Plus the two ways back: dragging one job
   onto another, and putting it back on its own bill.

   On the drag: Chromium driven headlessly will not perform a native HTML5
   drag — CDP mouse events don't start one — so the drag is exercised by
   dispatching the same dragstart/dragover/drop events with a real
   DataTransfer, which is what the handlers read. That covers the handler
   logic and the fall-through rule; what it cannot prove is that the browser
   fires those events in that order, which is browser behaviour the board's
   existing date-and-tech drag has relied on since day one. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1280,height:950} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${REPO_DIR}/index.html`); await pg.waitForTimeout(450);

  const jid = await pg.evaluate(() => {
    Store.data.settings.gst = "";
    const j = Store.data.jobs[0];
    Object.assign(j, { status:"in_progress", payment:null, billWith:null,
      flatPrice: 6000, laborHours: 0,
      parts: [{ desc:"Strip out and rebuild", qty:1, price:0 }] });
    Store.save(); return j.id;
  });
  const open = async id => { await pg.evaluate(i => openJob(i), id); await pg.waitForTimeout(400); };
  const txt  = () => pg.evaluate(() => document.querySelector('#modal-root').innerText);

  await t('a job offers a change of scope', async () => {
    await open(jid);
    const there = await pg.evaluate(() => !!document.querySelector('[data-scope-job]'));
    if (!there) throw new Error('no Change of scope button on the job');
  });

  await t('a cancelled job does not, because there is nothing to add to', async () => {
    const there = await pg.evaluate(id => {
      const j = Store.job(id), keep = j.status;
      j.status = "cancelled"; Store.save(); openJob(id);
      const found = !!document.querySelector('[data-scope-job]');
      j.status = keep; Store.save(); return found;
    }, jid);
    if (there) throw new Error('offered on a cancelled job');
  });

  await t('it opens an estimate already pointed at that job and customer', async () => {
    await open(jid);
    await pg.click('[data-scope-job]'); await pg.waitForTimeout(400);
    const r = await pg.evaluate(id => ({
      scope: (document.querySelector('#e-scopeof') || {}).value,
      who:   (document.querySelector('#who') || {}).value,
      cust:  (document.querySelector('#e-customer') || {}).value,
      want:  Store.job(id).customerId
    }), jid);
    if (r.scope !== jid) throw new Error('the form is not tied to the job: ' + r.scope);
    if (r.who !== "existing") throw new Error('it asked for a new contact instead: ' + r.who);
    if (r.cust !== r.want) throw new Error('the wrong customer is picked: ' + r.cust);
  });

  await t('and it says plainly what will happen to the bill', async () => {
    const body = await txt();
    if (!/change of scope on job #/i.test(body)) throw new Error('no explanation shown');
    if (!/one bill/i.test(body)) throw new Error('it does not say she gets one bill: ' + body.slice(0,400));
  });

  let eid;
  await t('saving it keeps the link on the estimate', async () => {
    await pg.evaluate(() => { document.querySelector('#e-desc').value = "Rotten subfloor under the tub"; });
    await pg.click('[data-save-estimate]'); await pg.waitForTimeout(500);
    eid = await pg.evaluate(() => {
      const e = Store.data.estimates[Store.data.estimates.length-1];
      return e && e.scopeOf ? e.id : null;
    });
    if (!eid) throw new Error('the estimate came out with no link to the job');
    const on = await pg.evaluate(i => Store.estimate(i).scopeOf, eid);
    if (on !== jid) throw new Error('linked to ' + on + ' instead of the job');
  });

  await t('a plain new estimate is not tied to anything', async () => {
    const r = await pg.evaluate(() => {
      openEstimateForm(null);
      const el = document.querySelector('#e-scopeof');
      const who = (document.querySelector('#who') || {}).value;
      closeModal();
      return { v: el ? el.value : "missing", who };
    });
    if (r.v !== "") throw new Error('a blank estimate carried a job link: ' + r.v);
    if (r.who !== "lead") throw new Error('the normal form changed shape: ' + r.who);
  });

  let kid;
  await t('when she approves it, the extra work becomes its own job', async () => {
    kid = await pg.evaluate(i => {
      const e = Store.estimate(i);
      e.items = [{ desc:"Subfloor repair", qty:1, price:900 }];
      Store.save();
      const j = Store.setEstStatus ? null : null;
      const made = Store.jobFromApproved(e);
      return made ? made.id : null;
    }, eid);
    if (!kid) throw new Error('approving it made no job');
    const sep = await pg.evaluate(k => Store.job(k).id, kid);
    if (sep === jid) throw new Error('it folded into the original job instead of being its own');
  });

  await t('and it comes out already on the original invoice', async () => {
    const on = await pg.evaluate(k => Store.job(k).billWith, kid);
    if (on !== jid) throw new Error('billWith is ' + on + ', wanted the original job');
  });

  await t('the original job now bills for both', async () => {
    const n = await pg.evaluate(i => Store.invoiceTotal(Store.job(i)), jid);
    if (n !== 6900) throw new Error('invoice total is ' + n + ', wanted 6900');
  });

  await t('the job panel says where the money goes, on both jobs', async () => {
    await open(jid);
    let body = await txt();
    if (!/One invoice, covering this job and 1 change of scope/i.test(body))
      throw new Error('the main job does not say it carries the extra: ' + body.slice(0,500));
    await open(kid);
    body = await txt();
    if (!/raises none of its own/i.test(body))
      throw new Error('the added job does not say it raises no invoice: ' + body.slice(0,500));
  });

  await t('he can put it back on its own bill from the added job', async () => {
    await open(kid);
    await pg.click('[data-bill-apart]'); await pg.waitForTimeout(450);
    const r = await pg.evaluate(k => ({ on: Store.job(k).billWith, panel: document.querySelector('#modal-root').innerText }), kid);
    if (r.on) throw new Error('still billed with ' + r.on);
    if (!/#/.test(r.panel)) throw new Error('he was left with no panel open');
  });

  await t('and from the main job, which leaves him looking at the main job', async () => {
    await pg.evaluate(k => { Store.billTogether(Store.job(k), Store.job(Store.data.jobs[0].id)); }, kid);
    await open(jid);
    await pg.click('[data-bill-apart]'); await pg.waitForTimeout(450);
    const r = await pg.evaluate(i => ({
      on: Store.job(Store.data.jobs[Store.data.jobs.length-1].id).billWith,
      head: document.querySelector('#modal-root').innerText.slice(0,40)
    }), jid);
    if (r.on) throw new Error('unlinking from the main job did nothing');
    const no = await pg.evaluate(i => Store.job(i).no, jid);
    if (!r.head.includes('#' + no)) throw new Error('he was thrown onto another job: ' + r.head);
  });

  /* ---- dragging one job onto another. See the note at the top. ---- */
  /* What the drop did. The card and the cell underneath it are two different
     answers, and "something accepted it" cannot tell them apart: a drop that
     correctly falls through to the cell also leaves the event prevented. So
     each one is read off the thing it highlights — the card goes mergeover,
     the cell goes dragover — and the ask modal says the card acted. */
  const drag = (fromId, ontoId) => pg.evaluate(([a, bq]) => {
    closeModal();
    const sel = id => `.jobcard[data-job="${id}"], .minicard[data-job="${id}"]`;
    const from = document.querySelector(sel(a));
    const onto = document.querySelector(sel(bq));
    if (!from || !onto) return { err: "no cards on screen" };
    const cell = onto.closest("[data-drop]");
    if (!cell) return { err: "the card is not sitting in a cell that takes a drop" };
    const dt = new DataTransfer();
    from.dispatchEvent(new DragEvent("dragstart", { bubbles:true, dataTransfer:dt }));
    const over = new DragEvent("dragover", { bubbles:true, cancelable:true, dataTransfer:dt });
    onto.dispatchEvent(over);
    const seen = { prevented: over.defaultPrevented,
                   card: onto.className.includes("mergeover"),
                   cell: cell.className.includes("dragover") };
    const drop = new DragEvent("drop", { bubbles:true, cancelable:true, dataTransfer:dt });
    onto.dispatchEvent(drop);
    seen.asked = !!document.querySelector('[data-merge-ask]');
    from.dispatchEvent(new DragEvent("dragend", { bubbles:true, dataTransfer:dt }));
    return seen;
  }, [fromId, ontoId]);

  /* The draggable cards live in the schedule view, inside the day/tech cells
     that take a drop. wireBoard only runs there, and only with no search. */
  const toBoard = async () => {
    await pg.evaluate(([a,c]) => {
      Store.job(a).scheduledDate = todayStr();
      Store.job(c).scheduledDate = todayStr();
      Store.job(c).status = "scheduled";
      App.search = ""; Store.save(); go("schedule");
    }, [jid, kid]);
    await pg.waitForTimeout(500);
  };

  await t('the board is showing both jobs to drag', async () => {
    await toBoard();
    const r = await pg.evaluate(([a,c]) => [a,c].map(id =>
      !!document.querySelector(`.minicard[data-job="${id}"], .jobcard[data-job="${id}"]`)), [jid, kid]);
    if (!r.every(Boolean)) throw new Error('a job is not on the board: ' + JSON.stringify(r));
  });

  await t('dropping one job on another asks before it changes the bill', async () => {
    const r = await drag(kid, jid);
    if (r.err) throw new Error(r.err);
    if (!r.card) throw new Error('the card gave no sign it would take the drop');
    if (r.cell) throw new Error('the cell lit up too, so he cannot tell what will happen');
    if (!r.asked) throw new Error('it merged without asking');
  });

  await t('the ask shows what one bill would come to', async () => {
    const body = await txt();
    if (!/One bill for/i.test(body)) throw new Error('no combined figure: ' + body.slice(0,400));
    if (!/\$6,900\.00/.test(body)) throw new Error('the combined figure is wrong: ' + body.slice(0,400));
  });

  await t('leaving it alone changes nothing at all', async () => {
    await pg.click('[data-merge-ask="no"]'); await pg.waitForTimeout(350);
    const on = await pg.evaluate(k => Store.job(k).billWith, kid);
    if (on) throw new Error('it linked them anyway: ' + on);
  });

  await t('saying yes bills them together', async () => {
    await toBoard();
    await drag(kid, jid);
    await pg.click('[data-merge-ask="bill"]'); await pg.waitForTimeout(400);
    const on = await pg.evaluate(k => Store.job(k).billWith, kid);
    if (on !== jid) throw new Error('billWith is ' + on);
  });

  await t('a job for another customer falls through and still reschedules', async () => {
    const r = await pg.evaluate(k => { Store.billSeparately(Store.job(k));
      const j = Store.job(k); j.customerId = "nobody_else"; Store.save(); return j.customerId; }, kid);
    if (r !== "nobody_else") throw new Error('setup failed');
    await toBoard();
    const d = await drag(kid, jid);
    if (d.err) throw new Error(d.err);
    if (d.card) throw new Error('the card lit up as if it would take it');
    if (d.asked) throw new Error('it asked about billing two different customers together');
    if (!d.cell) throw new Error('the drop did not reach the cell — rescheduling onto a card would break');
    if (!d.prevented) throw new Error('nothing accepted the drop at all');
  });

  await t('nor does it offer when the invoice has already gone out', async () => {
    const d = await pg.evaluate(([k,i]) => {
      const c = Store.job(k); c.customerId = Store.job(i).customerId;
      Store.job(i).payment = Object.assign(blankPayment(), { status:"invoiced" });
      Store.save(); return null;
    }, [kid, jid]).then(() => toBoard()).then(() => drag(kid, jid));
    if (d.err) throw new Error(d.err);
    if (d.card || d.asked)
      throw new Error('it offered to add work to an invoice the customer already has');
    if (!d.cell) throw new Error('and it stopped the drop reaching the cell as well');
  });

  await b.close();
  if (errs.length){
    // Naming them matters: a console or page error is a failure too, and it
    // is recorded by the listeners above without ever printing a FAIL line.
    console.log('\n' + errs.length + ' problem(s)');
    errs.forEach(e => console.log('  - ' + e));
    process.exit(1);
  }
  console.log('\nall good');
})();
