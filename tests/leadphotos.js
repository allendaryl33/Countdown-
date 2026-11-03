const { chromium } = require(process.env.PW || 'playwright-core');
const APP='http://127.0.0.1:54321/index.html', URL_='http://127.0.0.1:54321', KEY='sb_publishable_test';
const errs=[];
const ROW = { id:7, name:'Marcy Dunn', contact:'780-555-0199', service:'Drain Cleaning',
  description:'Water coming up in the basement floor drain when the washer runs.',
  timing:'Any weekday', source:'website', status:'new', created_at:'2026-10-27T15:00:00Z',
  photos:['inq/7/a.jpg','inq/7/b.jpg'] };
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  await fetch(URL_+'/__reset');
  await fetch(URL_+'/__inq', { method:'POST', body: JSON.stringify({ rows:[ROW], mode:'ok' }) });

  const pg = await b.newPage({ viewport:{width:1280,height:1100} });
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text())});
  await pg.goto(APP); await pg.waitForTimeout(400);
  await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'T'}; Cloud.saveCfg();
    return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY]);
  await pg.waitForTimeout(1000);
  const go = async () => { await pg.evaluate(() => { App.view='leads'; render(); }); await pg.waitForTimeout(600); };

  await t('photo paths come off the inquiry row', async () => {
    const l = await pg.evaluate(() => Store.leadsOpen().find(x => x.id === '7'));
    if (!l) throw new Error('lead not read');
    if (l.photos.length !== 2) throw new Error('photos: ' + JSON.stringify(l.photos));
  });

  await t('the lead card shows a thumbnail per photo, and they load', async () => {
    await go();
    const cells = await pg.$$('.lead-shots .ls');
    if (cells.length !== 2) throw new Error('cells: ' + cells.length);
    await pg.waitForTimeout(900);
    const on = await pg.$$eval('.lead-shots .ls', e => e.filter(x => x.classList.contains('on')).length);
    if (on !== 2) throw new Error('only ' + on + ' loaded');
    const bg = await pg.$eval('.lead-shots .ls', e => e.style.backgroundImage);
    if (!/inqdl/.test(bg)) throw new Error('not a signed url: ' + bg);
  });

  await t('tapping one opens it full size', async () => {
    await pg.click('.lead-shots .ls'); await pg.waitForTimeout(900);
    const img = await pg.$('#modal-root .modal-body img');
    if (!img) throw new Error('no full-size image');
    const src = await img.getAttribute('src');
    if (!/inqdl/.test(src)) throw new Error('src: ' + src);
    await pg.evaluate(() => closeModal());
  });

  await t('a lead with no photos shows no strip at all', async () => {
    await fetch(URL_+'/__inq', { method:'POST',
      body: JSON.stringify({ rows:[Object.assign({}, ROW, { id:8, photos:[] })] }) });
    await pg.evaluate(() => Cloud.pullInquiries()); await pg.waitForTimeout(400);
    await go();
    if (await pg.$('.lead-shots')) throw new Error('empty strip rendered');
  });

  await t('making an estimate from the lead shows them too', async () => {
    await fetch(URL_+'/__inq', { method:'POST', body: JSON.stringify({ rows:[ROW] }) });
    await pg.evaluate(() => { Store.data.leadsDone = {}; Store.save(); return Cloud.pullInquiries(); });
    await pg.waitForTimeout(400);
    await go();
    await pg.click('[data-lead-est="7"]'); await pg.waitForTimeout(900);
    const r = await pg.evaluate(() => {
      const e = Store.data.estimates[Store.data.estimates.length-1];
      return { from:e.fromLead, log:e.log.map(l=>l.text).join(' | ') };
    });
    if (r.from !== '7') throw new Error('estimate does not remember the lead: ' + r.from);
    if (!/4 photos they sent|2 photos they sent/.test(r.log)) throw new Error('log: ' + r.log);
    const tx = await pg.evaluate(() => document.querySelector('#modal-root').textContent.replace(/\s+/g,' '));
    if (!/What they sent in/.test(tx)) throw new Error('photos not shown on the estimate');
    await pg.waitForTimeout(900);
    const on = await pg.$$eval('#modal-root .lead-shots .ls', e => e.filter(x => x.classList.contains('on')).length);
    if (on !== 2) throw new Error('they did not load on the estimate: ' + on);
    await pg.evaluate(() => closeModal());
  });

  await t('booking the job keeps the photos with it', async () => {
    await fetch(URL_+'/__inq', { method:'POST', body: JSON.stringify({ rows:[ROW] }) });
    await pg.evaluate(() => { Store.data.leadsDone = {}; Store.save(); return Cloud.pullInquiries(); });
    await pg.waitForTimeout(400);
    await go();
    await pg.click('[data-lead-job="7"]'); await pg.waitForTimeout(900);
    const r = await pg.evaluate(() => {
      const j = Store.data.jobs[Store.data.jobs.length-1];
      return { from:j.fromLead, log:j.log.map(l=>l.text).join(' | ') };
    });
    if (r.from !== '7') throw new Error('job does not remember the lead: ' + r.from);
    if (!/2 photos they sent/.test(r.log)) throw new Error('log: ' + r.log);
    const tx = await pg.evaluate(() => document.querySelector('#modal-root').textContent.replace(/\s+/g,' '));
    if (!/What they sent in/.test(tx)) throw new Error('not shown on the job');
    await pg.waitForTimeout(900);
    const on = await pg.$$eval('#modal-root .lead-shots .ls', e => e.filter(x => x.classList.contains('on')).length);
    if (on !== 2) throw new Error('photos did not load on the job: ' + on);
    await pg.evaluate(() => closeModal());
  });

  console.log('--- the signing address ---');
  await t('links use this app\'s address until he sets his own', async () => {
    const u = await pg.evaluate(() => signLinkUrl('abc123'));
    if (!/127\.0\.0\.1:54321\/sign\.html#t=abc123/.test(u)) throw new Error(u);
  });

  await t('setting his own domain changes every link', async () => {
    await pg.evaluate(() => { Store.data.settings.signBase = 'https://poseidonplumbing.ca/sign/'; Store.save(); });
    const u = await pg.evaluate(() => signLinkUrl('abc123'));
    if (!u.startsWith('https://poseidonplumbing.ca/sign#t=abc123')) throw new Error(u);
    const [page] = u.split('#');
    if (/github\.io|127\.0\.0\.1/.test(page)) throw new Error('page address unchanged: ' + page);
    if (!/[#&]u=/.test(u) || !/[#&]k=/.test(u)) throw new Error('lost the config: ' + u);
  });

  await t('short links carry the code and nothing else', async () => {
    await pg.evaluate(() => {
      Object.assign(Store.data.settings,
        { signBase:'https://poseidonplumbing.ca/sign', signShort:true });
      Store.save();
    });
    const u = await pg.evaluate(() => signLinkUrl('a7f3c91e'));
    if (u !== 'https://poseidonplumbing.ca/sign#t=a7f3c91e') throw new Error(u);
    if (/[&?]k=/.test(u)) throw new Error('the key is still in the link');
    console.log('       ' + u + '  (' + u.length + ' chars)');
  });

  await t('a long link is still produced until that is ticked', async () => {
    await pg.evaluate(() => { Store.data.settings.signShort = false; Store.save(); });
    const u = await pg.evaluate(() => signLinkUrl('a7f3c91e'));
    if (!/[#&]u=/.test(u) || !/[#&]k=/.test(u))
      throw new Error('dropped the project details with no page to hold them: ' + u);
  });

  await t('short links are never produced for the default address', async () => {
    // A generic copy of the page cannot know whose project it is.
    await pg.evaluate(() => { Store.data.settings.signBase = ''; Store.data.settings.signShort = true; Store.save(); });
    const u = await pg.evaluate(() => signLinkUrl('a7f3c91e'));
    if (!/[#&]k=/.test(u)) throw new Error('made an unopenable link: ' + u);
    await pg.evaluate(() => { Store.data.settings.signBase = 'https://poseidonplumbing.ca/sign'; Store.save(); });
  });

  await t('it has its own card, not buried in the tax row', async () => {
    await pg.evaluate(() => { App.view='data'; App.search=''; render(); });
    await pg.waitForTimeout(400);
    const where = await pg.evaluate(() => {
      const f = document.querySelector('#set-signbase');
      if (!f) return { found:false };
      const card = f.closest('.card');
      const head = card ? card.querySelector('.card-head h3') : null;
      return { found:true, card: head ? head.textContent.trim() : '(none)',
               inRow3: !!f.closest('.row3') };
    });
    if (!where.found) throw new Error('the field is not on the page at all');
    if (where.inRow3) throw new Error('still inside a three-column row');
    if (!/signing/i.test(where.card)) throw new Error('lives under "' + where.card + '"');
    console.log('       under "' + where.card + '"');
  });

  await t('every three-column row still holds exactly three fields', async () => {
    const bad = await pg.$$eval('.row3', rows => rows
      .map(r => r.children.length).filter(n => n !== 3));
    if (bad.length) throw new Error('rows with ' + JSON.stringify(bad) + ' children');
  });

  await t('the invoice note did not get swallowed into the tax row', async () => {
    const r = await pg.evaluate(() => {
      const n = document.querySelector('#set-invnote');
      return n ? { there:true, inRow3: !!n.closest('.row3') } : { there:false };
    });
    if (!r.there) throw new Error('the invoice note field vanished');
    if (!r.inRow3) throw new Error('expected it back in its row3 group');
  });

  await t('it survives a save from the settings screen', async () => {
    await pg.evaluate(() => { App.view='data'; render(); }); await pg.waitForTimeout(400);
    await pg.fill('#set-signbase', 'https://poseidonplumbing.ca/sign');
    await pg.click('[data-save-settings], #btn-save-settings').catch(async () => {
      await pg.evaluate(() => { const b = Array.from(document.querySelectorAll('button'))
        .find(x => /Save settings/i.test(x.textContent)); if (b) b.click(); });
    });
    await pg.waitForTimeout(500);
    const v = await pg.evaluate(() => Store.data.settings.signBase);
    if (v !== 'https://poseidonplumbing.ca/sign') throw new Error('saved as ' + v);
  });

  await b.close();
  console.log('\n=== failures: '+errs.length+' ===');
  errs.forEach(e=>console.log('  '+e));
  process.exit(errs.length?1:0);
})();
