/* "Sent three days ago, never opened" is a different phone call from
   "opened four times, no answer". */
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

  await t('an unopened estimate says so plainly', async () => {
    const s = await pg.evaluate(() => openedNote({ viewed_at:null, view_count:0 }));
    if (s !== "Not opened yet") throw new Error('reads "' + s + '"');
  });

  await t('one view reads as one view', async () => {
    const s = await pg.evaluate(() =>
      openedNote({ viewed_at: new Date(Date.now() - 2*3600000).toISOString(), view_count: 1 }));
    if (!/Opened 2 hours ago/.test(s)) throw new Error('reads "' + s + '"');
    if (/times/.test(s)) throw new Error('should not say "times" for one');
  });

  await t('repeat views are worth knowing about', async () => {
    const s = await pg.evaluate(() =>
      openedNote({ viewed_at: new Date(Date.now() - 3*86400000).toISOString(), view_count: 4 }));
    if (!/Opened 3 days ago/.test(s)) throw new Error('reads "' + s + '"');
    if (!/4 times/.test(s)) throw new Error('does not say how many');
  });

  await t('the clock reads naturally at every scale', async () => {
    const r = await pg.evaluate(() => {
      const ago = ms => sinceShort(new Date(Date.now() - ms).toISOString());
      return { now: ago(5000), min: ago(60000), mins: ago(25*60000),
               hr: ago(3600000), day: ago(86400000), days: ago(5*86400000) };
    });
    const want = { now:"just now", min:"1 minute ago", mins:"25 minutes ago",
                   hr:"1 hour ago", day:"1 day ago", days:"5 days ago" };
    for (const k in want) if (r[k] !== want[k])
      throw new Error(k + ' reads "' + r[k] + '", expected "' + want[k] + '"');
  });

  await t('the estimate out for signature says whether it was opened', async () => {
    const eid = await pg.evaluate(() => {
      const e = Store.data.estimates.find(x => (x.items||[]).length);
      e.status = "sent"; delete e.approval; e.linkSentAt = Date.now(); Store.save();
      Cloud.signLinks = [{ token:"tok1", estimate_id:e.id, signed_at:null,
        created_at:new Date().toISOString(),
        expires_at:new Date(Date.now()+30*86400000).toISOString(),
        viewed_at:new Date(Date.now()-90*60000).toISOString(), view_count:3 }];
      return e.id;
    });
    await pg.evaluate(id => openEstimate(id), eid); await pg.waitForTimeout(450);
    const tx = await pg.evaluate(() => document.querySelector('#modal-root').textContent.replace(/\s+/g,' '));
    if (!/Opened 1 hour ago/.test(tx)) throw new Error('no opened note :: ' + tx.slice(0,260));
    if (!/3 times/.test(tx)) throw new Error('does not say how many times');
    await pg.evaluate(() => closeModal());
  });

  await t('and says so when it has not been', async () => {
    const eid = await pg.evaluate(() => {
      const e = Store.data.estimates.find(x => (x.items||[]).length);
      Cloud.signLinks = [{ token:"tok2", estimate_id:e.id, signed_at:null,
        created_at:new Date().toISOString(),
        expires_at:new Date(Date.now()+30*86400000).toISOString(),
        viewed_at:null, view_count:0 }];
      return e.id;
    });
    await pg.evaluate(id => openEstimate(id), eid); await pg.waitForTimeout(450);
    const tx = await pg.evaluate(() => document.querySelector('#modal-root').textContent.replace(/\s+/g,' '));
    if (!/Not opened yet/.test(tx)) throw new Error('no note :: ' + tx.slice(0,260));
    await pg.evaluate(() => closeModal());
  });

  await t('the estimates list shows it without opening each record', async () => {
    const eid = await pg.evaluate(() => {
      const e = Store.data.estimates.find(x => (x.items||[]).length);
      e.status = "sent"; delete e.approval; e.linkSentAt = Date.now(); Store.save();
      Cloud.signLinks = [{ token:"tokL", estimate_id:e.id, signed_at:null,
        created_at:new Date().toISOString(),
        expires_at:new Date(Date.now()+30*86400000).toISOString(),
        viewed_at:new Date(Date.now()-5*3600000).toISOString(), view_count:2 }];
      go("estimates"); App.estFilter = "open"; render();
      return e.id;
    });
    await pg.waitForTimeout(400);
    const row = await pg.evaluate(id => {
      const r = document.querySelector('[data-estimate="'+id+'"]');
      return r ? r.textContent.replace(/\s+/g,' ') : null;
    }, eid);
    if (row === null) throw new Error('the estimate is not in the list');
    if (!/Opened 5 hours ago/.test(row)) throw new Error('row says nothing :: ' + row);
    if (!/2 times/.test(row)) throw new Error('no count on the row');
  });

  await t('and says so on the row when it has not been opened', async () => {
    const eid = await pg.evaluate(() => {
      const e = Store.data.estimates.find(x => x.status === "sent");
      Cloud.signLinks = [{ token:"tokM", estimate_id:e.id, signed_at:null,
        created_at:new Date().toISOString(),
        expires_at:new Date(Date.now()+30*86400000).toISOString(),
        viewed_at:null, view_count:0 }];
      render(); return e.id;
    });
    await pg.waitForTimeout(350);
    const row = await pg.evaluate(id => {
      const r = document.querySelector('[data-estimate="'+id+'"]');
      return r ? r.textContent.replace(/\s+/g,' ') : '';
    }, eid);
    if (!/Not opened yet/.test(row)) throw new Error('row says nothing :: ' + row);
  });

  await t('a draft with no link out says nothing at all', async () => {
    const quiet = await pg.evaluate(() => {
      const e = Store.data.estimates.find(x => x.status === "sent");
      e.status = "draft"; Store.save(); render();
      const r = document.querySelector('[data-estimate="'+e.id+'"]');
      return r ? !/opened/i.test(r.textContent) : true;
    });
    if (!quiet) throw new Error('a draft is claiming something about views');
  });

  await t('the invoice row shows it too — the data was already there', async () => {
    const r = await pg.evaluate(() => {
      const j = Store.data.jobs.find(x => Store.jobTotal(x) > 0);
      j.status = "complete";
      Store.setPayment(j, { status:"invoiced", amountPaid: 0 });
      Cloud.invoiceLinks = [{ token:"inv1", job_id:j.id, paid_at:null,
        viewed_at:new Date(Date.now()-4*3600000).toISOString(), view_count:2 }];
      go("invoices"); App.invTab = "out"; render();
      return j.id;
    });
    await pg.waitForTimeout(400);
    const tx = await pg.evaluate(() => document.body.textContent.replace(/\s+/g,' '));
    if (!/Opened 4 hours ago/.test(tx)) throw new Error('invoice row says nothing :: ' + tx.slice(0,300));
    if (!/2 times/.test(tx)) throw new Error('no count on the invoice row');
  });

  await t('the signing page asks the database to record the view', async () => {
    const fs = require('fs');
    const sign = fs.readFileSync(`${REPO_DIR}/sign.html`,'utf8');
    if (!/mark_estimate_viewed/.test(sign)) throw new Error('sign.html never records a view');
    if (!/\.catch\(/.test(sign.slice(sign.indexOf('mark_estimate_viewed') - 60,
                                   sign.indexOf('mark_estimate_viewed') + 120)))
      throw new Error('a failed stamp could break the page for the customer');
  });

  await t('the migration adds the columns and the function, re-runnably', async () => {
    const sql = require('fs').readFileSync(`${REPO_DIR}/supabase-viewed.sql`,'utf8');
    for (const want of ['add column if not exists viewed_at',
                        'add column if not exists view_count',
                        'create or replace function public.mark_estimate_viewed',
                        'security definer',
                        'grant execute on function public.mark_estimate_viewed(text) to anon'])
      if (!sql.includes(want)) throw new Error('migration is missing: ' + want);
    if (/grant .*(select|insert|update|delete).* on public\.estimate_links to anon/i.test(sql))
      throw new Error('the migration hands anon table rights');
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
