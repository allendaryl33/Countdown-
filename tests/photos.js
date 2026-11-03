const { chromium } = require(process.env.PW || 'playwright-core');
const URL_='http://127.0.0.1:54321', KEY='sb_publishable_test', errs=[];

// a real JPEG the browser can actually decode: 1200x900, drawn in-page
const MAKE_FILE = `(name, w, h, colour) => {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = colour; g.fillRect(0,0,w,h);
  g.fillStyle = '#fff'; g.font = 'bold 120px sans-serif'; g.fillText(name, 40, h/2);
  return new Promise(res => cv.toBlob(b => res(new File([b], name + '.jpg', { type:'image/jpeg' })), 'image/jpeg', 0.95));
}`;

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const pg = await b.newPage({ viewport:{width:430,height:930} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{const x=m.text(); if(m.type()==='error' && !/ERR_INTERNET_DISCONNECTED/.test(x)) errs.push('CONSOLE: '+x)});
  await fetch(URL_+'/__reset');
  await pg.goto(URL_+'/index.html'); await pg.waitForTimeout(500);
  await pg.evaluate(src => { window.mkFile = eval(src); }, MAKE_FILE);

  const shoot = (kind, id, names, w, h) => pg.evaluate(async ([k,i,ns,W,H]) => {
    const files = [];
    for (const n of ns) files.push(await window.mkFile(n, W, H, '#1f6f9a'));
    await takePhotos(k, i, files);
    return true;
  }, [kind, id, names, w || 2400, h || 1800]);

  let jobId, estId;

  console.log('--- the actual button, not the function behind it ---');
  await t('picking a file through the real input adds the photo', async () => {
    const jid = await pg.evaluate(() => { const j = Store.data.jobs.find(x=>isOpen(x)); openJob(j.id); return j.id; });
    await pg.waitForTimeout(400);
    const before = await pg.evaluate(i => Store.photosOf(Store.job(i)).length, jid);
    await pg.setInputFiles('[data-ph-file]', process.env.SP + '/testphoto.jpg');
    await pg.waitForTimeout(1400);
    const after = await pg.evaluate(i => Store.photosOf(Store.job(i)).length, jid);
    if (after !== before + 1)
      throw new Error('the change handler produced nothing: ' + before + ' -> ' + after);
    console.log('       label -> input -> handler -> stored');
  });

  await t('the input is reachable, not display:none', async () => {
    const st = await pg.evaluate(() => {
      const i = document.querySelector('[data-ph-file]');
      const c = getComputedStyle(i);
      return { hidden: i.hidden, display: c.display };
    });
    if (st.hidden || st.display === 'none')
      throw new Error('an unrendered file input is what mobile browsers refuse to open: ' + JSON.stringify(st));
  });

  await t('the same photo can be picked twice in a row', async () => {
    const jid = await pg.evaluate(() => Store.data.jobs.find(x=>isOpen(x)).id);
    const before = await pg.evaluate(i => Store.photosOf(Store.job(i)).length, jid);
    await pg.setInputFiles('[data-ph-file]', process.env.SP + '/testphoto.jpg');
    await pg.waitForTimeout(1200);
    const after = await pg.evaluate(i => Store.photosOf(Store.job(i)).length, jid);
    if (after !== before + 1) throw new Error('second pick of the same file did nothing');
    await pg.evaluate(i => { const j = Store.job(i); j.photos = []; Store.save(); closeModal(); }, jid);
    await pg.evaluate(async () => { for (const k of await Photos.keys()) await Photos.del(k); });
    console.log('       twice in a row, then reset for the rest');
  });

  console.log('--- taking a photo on site ---');
  await t('a 2400px phone photo is shrunk before it is kept', async () => {
    jobId = await pg.evaluate(() => { const j = Store.data.jobs.find(x => isOpen(x)); openJob(j.id); return j.id; });
    await pg.waitForTimeout(400);
    await shoot('job', jobId, ['BEFORE']);
    const p = await pg.evaluate(id => Store.photosOf(Store.job(id))[0], jobId);
    if (!p) throw new Error('nothing recorded');
    if (p.w > 1600 || p.h > 1600) throw new Error('not resized: ' + p.w + 'x' + p.h);
    if (p.size > 400*1024) throw new Error('still ' + Math.round(p.size/1024) + ' KB');
    console.log('       2400px -> ' + p.w + 'x' + p.h + ', ' + Math.round(p.size/1024) + ' KB');
  });

  await t('the picture itself is on the device, not in the shop record', async () => {
    const pid = await pg.evaluate(id => Store.photosOf(Store.job(id))[0].id, jobId);
    const has = await pg.evaluate(async i => !!(await Photos.get(i)), pid);
    if (!has) throw new Error('no blob stored locally');
    const shop = await pg.evaluate(() => JSON.stringify(Store.data).length);
    const rec = await pg.evaluate(id => JSON.stringify(Store.photosOf(Store.job(id))), jobId);
    if (/base64|data:image/.test(rec)) throw new Error('image bytes leaked into the record');
    console.log('       blob in IndexedDB, record carries ' + rec.length + ' chars of metadata');
  });

  await t('several at once is one action', async () => {
    await shoot('job', jobId, ['AFTER','PLATE','CLOSEUP']);
    const n = await pg.evaluate(id => Store.photosOf(Store.job(id)).length, jobId);
    if (n !== 4) throw new Error('have ' + n);
  });

  await t('thumbnails appear once the blobs are read back', async () => {
    await pg.evaluate(id => openJob(id), jobId); await pg.waitForTimeout(900);
    const filled = await pg.evaluate(() =>
      [...document.querySelectorAll('[data-ph-img]')].filter(e => /url\(/.test(e.style.backgroundImage)).length);
    if (filled !== 4) throw new Error('only ' + filled + ' of 4 drew');
  });

  console.log('--- before and after ---');
  await t('a photo can be labelled, and the label shows on the tile', async () => {
    const ids = await pg.evaluate(id => Store.photosOf(Store.job(id)).map(p => p.id), jobId);
    await pg.evaluate(([j,p]) => { Store.setPhoto('job', j, p, { tag:'before' }); }, [jobId, ids[0]]);
    await pg.evaluate(([j,p]) => { Store.setPhoto('job', j, p, { tag:'after' }); }, [jobId, ids[1]]);
    await pg.evaluate(id => openJob(id), jobId); await pg.waitForTimeout(700);
    const tags = await pg.evaluate(() =>
      [...document.querySelectorAll('.ph-cell')].map(c => c.className).join(' '));
    if (!/tag-before/.test(tags) || !/tag-after/.test(tags)) throw new Error(tags);
    console.log('       before and after marked');
  });

  await t('an estimate takes them too', async () => {
    estId = await pg.evaluate(() => { const e = Store.data.estimates[0]; openEstimate(e.id); return e.id; });
    await pg.waitForTimeout(400);
    await shoot('estimate', estId, ['SITE'], 1800, 1200);
    const n = await pg.evaluate(id => Store.photosOf(Store.estimate(id)).length, estId);
    if (n !== 1) throw new Error('n=' + n);
  });

  console.log('--- what travels with the picture ---');
  await t("a customer's GPS location is stripped before anything is stored", async () => {
    const r = await pg.evaluate(async () => {
      // build a JPEG that really does carry EXIF GPS, in-page so the test
      // owns its own fixture
      const cv = document.createElement('canvas');
      cv.width = 900; cv.height = 700;
      const g = cv.getContext('2d'); g.fillStyle = '#28506e'; g.fillRect(0,0,900,700);
      const plain = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9));
      const src = new Uint8Array(await plain.arrayBuffer());

      const enc = s => Uint8Array.from(s, c => c.charCodeAt(0));
      const u16 = (v,le) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0,v,le); return b; };
      const u32 = (v,le) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0,v,le); return b; };
      const entry = (tag,typ,cnt,val) => {
        const o = new Uint8Array(12); const d = new DataView(o.buffer);
        d.setUint16(0,tag,true); d.setUint16(2,typ,true); d.setUint32(4,cnt,true);
        o.set(val,8); return o;
      };
      const cat = arrs => {
        const n = arrs.reduce((a,b)=>a+b.length,0), o = new Uint8Array(n);
        let i = 0; arrs.forEach(a => { o.set(a,i); i += a.length; }); return o;
      };
      const gps = cat([ u16(2,true),
        entry(1,2,2,enc('N\0\0\0')), entry(3,2,2,enc('W\0\0\0')), u32(0,true) ]);
      const tiff = cat([ enc('II*\0'), u32(8,true), u16(1,true),
        entry(0x8825,4,1,u32(26,true)), u32(0,true), gps ]);
      const payload = cat([ enc('Exif\0\0'), tiff ]);
      const app1 = cat([ enc('\xff\xe1'), u16(payload.length + 2, false), payload ]);
      const tagged = cat([ src.slice(0,2), app1, src.slice(2) ]);

      const srcTxt = Array.from(tagged.slice(0,3000)).map(c=>String.fromCharCode(c)).join('');
      const file = new File([tagged], 'geo.jpg', { type:'image/jpeg' });

      const { blob } = await Photos.shrink(file);
      const out = new Uint8Array(await blob.arrayBuffer());
      const outTxt = Array.from(out.slice(0,4000)).map(c=>String.fromCharCode(c)).join('');
      return { sourceHadExif: srcTxt.includes('Exif'), sourceHadGPS: srcTxt.includes('GPSL') || srcTxt.includes('N\0'),
               outHasExif: outTxt.includes('Exif'), outHasGPS: outTxt.includes('GPSL') };
    });
    if (!r.sourceHadExif) throw new Error('the fixture itself carried no EXIF, so this proves nothing');
    if (r.outHasExif) throw new Error('EXIF survived into storage');
    if (r.outHasGPS) throw new Error('GPS survived into storage');
    console.log('       source carried EXIF, what is stored carries none');
  });

  console.log('--- labelling ---');
  await t('a label of your own words can be written and sticks', async () => {
    const pid = await pg.evaluate(id => Store.photosOf(Store.job(id))[2].id, jobId);
    await pg.evaluate(i => openPhoto(i), pid); await pg.waitForTimeout(500);
    await pg.fill('#ph-tag-text', 'Main stack, 2nd floor');
    await pg.click('[data-ph-tagsave]'); await pg.waitForTimeout(500);
    const tag = await pg.evaluate(([j,i]) =>
      Store.photosOf(Store.job(j)).find(p => p.id === i).tag, [jobId, pid]);
    if (tag !== 'Main stack, 2nd floor') throw new Error('stored "' + tag + '"');
    console.log('       "' + tag + '"');
  });

  await t('a custom label cannot smuggle markup into the tile', async () => {
    const pid = await pg.evaluate(id => Store.photosOf(Store.job(id))[3].id, jobId);
    await pg.evaluate(([j,i]) => Store.setPhoto('job', j, i,
      { tag: '"><img src=x onerror=alert(1)>' }), [jobId, pid]);
    await pg.evaluate(id => openJob(id), jobId); await pg.waitForTimeout(700);
    const bad = await pg.evaluate(() => document.querySelectorAll('.ph-cell img[src="x"]').length);
    if (bad) throw new Error('markup in a label reached the page');
    const cls = await pg.evaluate(() =>
      [...document.querySelectorAll('.ph-cell')].some(c => /tag-"/.test(c.className)));
    if (cls) throw new Error('a free-text label became a class name');
    console.log('       escaped, and kept out of the class attribute');
  });

  await t('the quick Before and After buttons still work', async () => {
    const pid = await pg.evaluate(id => Store.photosOf(Store.job(id))[2].id, jobId);
    await pg.evaluate(i => openPhoto(i), pid); await pg.waitForTimeout(500);
    await pg.click('[data-ph-tag$=":before"]'); await pg.waitForTimeout(500);
    const tag = await pg.evaluate(([j,i]) =>
      Store.photosOf(Store.job(j)).find(p => p.id === i).tag, [jobId, pid]);
    if (tag !== 'before') throw new Error('tag is "' + tag + '"');
  });

  await t('the job log records photos the way it records clocking in', async () => {
    const log = await pg.evaluate(id => (Store.job(id).log || []).map(l => l.text).join(' | '), jobId);
    if (!/Photo added/.test(log)) throw new Error('nothing logged on add: ' + log.slice(-160));
    if (!/Photo labelled/.test(log)) throw new Error('nothing logged on labelling');
    console.log('       ' + log.split(' | ').filter(x => /Photo/.test(x)).slice(-2).join(' · '));
  });

  await t('there is a way to get a photo off the phone', async () => {
    const pid = await pg.evaluate(id => Store.photosOf(Store.job(id))[0].id, jobId);
    await pg.evaluate(i => openPhoto(i), pid); await pg.waitForTimeout(600);
    const dl = await pg.evaluate(() => {
      const a = document.querySelector('.modal-foot a[download]');
      return a ? { has: true, name: a.getAttribute('download'), href: a.href.slice(0,5) } : null;
    });
    if (!dl) throw new Error('no save-to-phone link');
    if (!/\.jpg$/.test(dl.name)) throw new Error('bad filename: ' + dl.name);
    console.log('       ' + dl.name);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
  });

  console.log('--- they never reach the customer ---');
  await t('nothing photographic prints on a ticket, estimate or waiver', async () => {
    await pg.evaluate(id => { closeModal(); printJobs([Store.job(id)], 'x'); }, jobId);
    await pg.waitForTimeout(250);
    let doc = await pg.evaluate(() => document.querySelector('#print-area').innerHTML);
    await pg.evaluate(id => printEstimate(Store.estimate(id)), estId);
    await pg.waitForTimeout(250);
    doc += await pg.evaluate(() => document.querySelector('#print-area').innerHTML);
    for (const bad of ['ph-grid','ph-cell','data-ph-img','blob:','Photos']){
      if (doc.includes(bad)) throw new Error('"' + bad + '" on a customer document');
    }
    console.log('       clean');
  });

  console.log('--- getting them off the phone ---');
  await t('nothing uploads while signed out, and nothing is lost', async () => {
    const pend = await pg.evaluate(() => Store.pendingPhotos().length);
    if (pend !== 5) throw new Error('pending=' + pend);
    const sent = await pg.evaluate(() => Cloud.flushPhotos());
    if (sent) throw new Error('claimed to upload ' + sent + ' with no connection set up');
    const still = await pg.evaluate(async () => (await Photos.keys()).length);
    if (still !== 5) throw new Error('blobs lost: ' + still);
    console.log('       5 waiting, 5 still on the device');
  });

  await t('signing in sends the backlog up', async () => {
    await pg.evaluate(([u,k]) => {
      Cloud.cfg = { url:u, key:k, email:'', deviceId:'Phone-x' }; Cloud.saveCfg();
      return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow());
    }, [URL_, KEY]);
    await pg.waitForTimeout(2500);
    const srv = await (await fetch(URL_+'/__state')).json();
    const n = Object.keys(srv.objects).length;
    if (n !== 5) throw new Error('server has ' + n + ' objects: ' + JSON.stringify(Object.keys(srv.objects)));
    const pend = await pg.evaluate(() => Store.pendingPhotos().length);
    if (pend) throw new Error(pend + ' still marked pending');
    const kb = Math.round(Object.values(srv.objects).reduce((a,b)=>a+b,0)/1024);
    console.log('       5 uploaded, ' + kb + ' KB total');
  });

  await t('going offline mid-shoot keeps the photo and queues it', async () => {
    await pg.context().setOffline(true);
    await pg.evaluate(id => openJob(id), jobId); await pg.waitForTimeout(400);
    await shoot('job', jobId, ['BASEMENT']);
    const r = await pg.evaluate(async id => ({
      recorded: Store.photosOf(Store.job(id)).length,
      pending: Store.pendingPhotos().length,
      blobs: (await Photos.keys()).length
    }), jobId);
    if (r.recorded !== 5) throw new Error('not recorded: ' + JSON.stringify(r));
    if (r.pending !== 1) throw new Error('not queued: ' + JSON.stringify(r));
    if (r.blobs !== 6) throw new Error('blob not kept: ' + JSON.stringify(r));
    console.log('       taken in a dead zone, kept, queued');
  });

  await t('and it goes up by itself when the signal returns', async () => {
    await pg.context().setOffline(false);
    await pg.evaluate(() => Cloud.syncNow());
    await pg.waitForTimeout(2500);
    const srv = await (await fetch(URL_+'/__state')).json();
    if (Object.keys(srv.objects).length !== 6) throw new Error('server has ' + Object.keys(srv.objects).length);
    const pend = await pg.evaluate(() => Store.pendingPhotos().length);
    if (pend) throw new Error(pend + ' still pending');
    console.log('       basement photo landed');
  });

  console.log('--- the other device ---');
  await t('a photo taken elsewhere is fetched with a signed link', async () => {
    const pid = await pg.evaluate(id => Store.photosOf(Store.job(id))[0].id, jobId);
    await pg.evaluate(async i => { await Photos.del(i); Photos._urls.delete(i); }, pid);
    const url = await pg.evaluate(async i => {
      const f = Store.findPhoto(i);
      return Cloud.signPhoto(f.photo.path);
    }, pid);
    if (!/token=/.test(url)) throw new Error('no token in: ' + url);
    const r = await fetch(url);
    if (!r.ok) throw new Error('signed link gave ' + r.status);
    const ct = r.headers.get('content-type');
    if (!/image/.test(ct || '')) throw new Error('content-type ' + ct);
    console.log('       signed link returned ' + ct);
  });

  await t('an unsigned link to the same object is refused', async () => {
    const pid = await pg.evaluate(id => Store.photosOf(Store.job(id))[1].id, jobId);
    const path = await pg.evaluate(i => Store.findPhoto(i).photo.path, pid);
    const r = await fetch(URL_ + '/storage/v1/object/job-photos/' + path);
    if (r.ok) throw new Error('a bare URL served a customer photo');
    console.log('       bare URL refused with ' + r.status);
  });

  console.log('--- deleting ---');
  await t('deleting takes it off the device and the server', async () => {
    const before = Object.keys((await (await fetch(URL_+'/__state')).json()).objects).length;
    const pid = await pg.evaluate(id => Store.photosOf(Store.job(id))[2].id, jobId);
    const path = await pg.evaluate(i => Store.findPhoto(i).photo.path, pid);
    await pg.evaluate(async ([j,i,pa]) => {
      Store.removePhoto('job', j, i);
      await Photos.del(i);
      await Cloud.deletePhoto(pa);
    }, [jobId, pid, path]);
    await pg.waitForTimeout(600);
    const after = Object.keys((await (await fetch(URL_+'/__state')).json()).objects).length;
    if (after !== before - 1) throw new Error(before + ' -> ' + after);
    const gone = await pg.evaluate(async i => !(await Photos.get(i)), pid);
    if (!gone) throw new Error('blob left on the device');
    console.log('       gone from both');
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
