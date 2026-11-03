/* An iPhone shoots HEIC. Chrome can't decode it, so the app must not pretend
   it attached something nobody will ever see. */
/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it if the app lives elsewhere. */
const APP = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const errs=[];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:1280,height:1000} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text())});
  await pg.goto(`file://${APP}/index.html`); await pg.waitForTimeout(450);

  const eid = await pg.evaluate(() => {
    const e = Store.data.estimates[0];
    e.photos = []; Store.save(); return e.id;
  });

  // a real HEIC header that no browser engine here can decode
  const makeHeic = () => pg.evaluate(() => {
    const head = [0,0,0,0x18,0x66,0x74,0x79,0x70,0x68,0x65,0x69,0x63,0,0,0,0,
                  0x68,0x65,0x69,0x63,0x6d,0x69,0x66,0x31];
    const bytes = new Uint8Array(2048);
    head.forEach((v,i) => bytes[i] = v);
    return new File([bytes], "IMG_4417.HEIC", { type:"image/heic" });
  });

  await t('a HEIC the browser cannot read is not attached at all', async () => {
    const r = await pg.evaluate(async id => {
      const head = [0,0,0,0x18,0x66,0x74,0x79,0x70,0x68,0x65,0x69,0x63,0,0,0,0,
                    0x68,0x65,0x69,0x63,0x6d,0x69,0x66,0x31];
      const bytes = new Uint8Array(2048); head.forEach((v,i) => bytes[i] = v);
      const f = new File([bytes], "IMG_4417.HEIC", { type:"image/heic" });
      const before = (Store.estimate(id).photos || []).length;
      await takePhotos("estimate", id, [f]);
      return { before, after: (Store.estimate(id).photos || []).length };
    }, eid);
    await pg.waitForTimeout(400);
    if (r.after !== r.before)
      throw new Error('it attached ' + (r.after - r.before) + ' unviewable photo(s)');
  });

  await t('and nothing is queued to upload off the back of it', async () => {
    const n = await pg.evaluate(() => Store.pendingPhotos().length);
    if (n) throw new Error(n + ' photo(s) queued that nobody can display');
  });

  await t('it says what the file is and what to do about it', async () => {
    const tx = await pg.evaluate(() => {
      const m = document.querySelector('#modal-root');
      return m ? m.textContent.replace(/\s+/g,' ') : '';
    });
    if (!/won't open here/i.test(tx)) throw new Error('no explanation shown :: ' + tx.slice(0,160));
    if (!/HEIC/.test(tx)) throw new Error('does not name the format');
    if (!/IMG_4417/.test(tx)) throw new Error('does not name the file');
    if (!/Convert Image/i.test(tx)) throw new Error('does not say how to fix it now');
    if (!/Most Compatible/i.test(tx)) throw new Error('does not say how to stop it recurring');
    await pg.evaluate(() => closeModal());
  });

  await t('shrink reports it rather than handing back the original', async () => {
    const r = await pg.evaluate(async () => {
      const head = [0,0,0,0x18,0x66,0x74,0x79,0x70,0x68,0x65,0x69,0x63];
      const bytes = new Uint8Array(1024); head.forEach((v,i) => bytes[i] = v);
      const f = new File([bytes], "x.heic", { type:"image/heic" });
      const out = await Photos.shrink(f);
      return { unreadable: !!out.unreadable, w: out.w, h: out.h };
    });
    if (!r.unreadable) throw new Error('shrink said it was fine');
  });

  await t('a PNG the browser can read still goes in normally', async () => {
    const r = await pg.evaluate(async id => {
      const cv = document.createElement('canvas'); cv.width = 400; cv.height = 300;
      const cx = cv.getContext('2d'); cx.fillStyle = '#28a'; cx.fillRect(0,0,400,300);
      const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      const f = new File([blob], "before.png", { type:"image/png" });
      const before = (Store.estimate(id).photos || []).length;
      await takePhotos("estimate", id, [f]);
      const after = Store.estimate(id).photos || [];
      return { grew: after.length - before, last: after[after.length-1] };
    }, eid);
    await pg.waitForTimeout(400);
    if (r.grew !== 1) throw new Error('a readable photo did not attach');
    if (!r.last || !r.last.w) throw new Error('it attached with no dimensions: ' + JSON.stringify(r.last));
  });

  await t('a mixed drop keeps the good one and refuses the bad one', async () => {
    const r = await pg.evaluate(async id => {
      const cv = document.createElement('canvas'); cv.width = 200; cv.height = 200;
      cv.getContext('2d').fillRect(0,0,200,200);
      const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      const good = new File([blob], "good.png", { type:"image/png" });
      const bytes = new Uint8Array(512);
      [0,0,0,0x18,0x66,0x74,0x79,0x70,0x68,0x65,0x69,0x63].forEach((v,i) => bytes[i] = v);
      const bad = new File([bytes], "bad.HEIC", { type:"image/heic" });
      const before = (Store.estimate(id).photos || []).length;
      await takePhotos("estimate", id, [good, bad]);
      return { grew: (Store.estimate(id).photos || []).length - before };
    }, eid);
    await pg.waitForTimeout(400);
    if (r.grew !== 1) throw new Error('expected exactly the good one, got ' + r.grew);
    await pg.evaluate(() => closeModal());
  });

  await b.close();
  if (errs.length){ console.log('\n' + errs.length + ' problem(s)'); process.exit(1); }
  console.log('\nall good');
})();
