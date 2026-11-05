/* His own calendar on the schedule, so he can see what's on before he books
   a job into it.

   The test that matters most is "an unreachable calendar is never shown as
   free". Helm had exactly that bug: an error read as an empty day. A plumber
   looking at an empty Tuesday afternoon books it, and if the app could not
   reach Google and said nothing, it told him a lie by omission.

   The whole Google side is stood in for by the mock's /functions/v1/personal-
   calendar, driven through /__cal. What is tested here is everything the app
   does with the answer: the states, the guards, the clash warning and the
   fact that nothing personal is ever written down. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
const APP = 'http://127.0.0.1:54321/index.html';
const URL_ = 'http://127.0.0.1:54321', KEY = 'sb_publishable_test';
const errs = [];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const t=async(n,fn)=>{try{await fn();console.log('  ok  '+n);}catch(e){console.log('  FAIL '+n+' :: '+e.message);errs.push(n+': '+e.message);}};
  const post = (p, body) => fetch(URL_+p, { method:'POST',
    headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{}) }).then(r=>r.json());
  await fetch(URL_+'/__reset').then(r=>r.json());

  const pg = await b.newPage({ viewport:{width:1400,height:950} });
  pg.on('pageerror', e => errs.push('PAGEERROR: '+e.message));
  pg.on('console', m => { if (m.type()==='error' && !/Failed to load resource/.test(m.text())) errs.push('CONSOLE: '+m.text()); });
  await pg.goto(APP); await pg.waitForTimeout(400);

  await pg.evaluate(([u,k]) => {
    Cloud.cfg = { url:u, key:k, email:'', deviceId:'Cal-test' };
    Cloud.saveCfg(); Cloud.state='signed-out';
  }, [URL_, KEY]);
  await pg.evaluate(() => Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()));

  /* Today, and a slot he has a job in, so a clash can be arranged. */
  const today = await pg.evaluate(() => todayStr());
  const show = async () => {
    await pg.evaluate(() => { App.search=''; go('schedule'); App.scheduleMode='day'; render(); });
    await pg.waitForTimeout(500);
  };
  const strip = () => pg.evaluate(() => {
    const el = document.querySelector('.pcal');
    return el ? { cls: el.className, text: el.innerText } : null;
  });
  const setCal = (mode, events, calendars) =>
    post('/__cal', { mode, events, calendars });
  const kick = async () => {           // make the app fetch the window afresh
    await pg.evaluate(() => { Cal.state='off'; Cal._failed=null; Cal.events=[]; });
    await show();
    await pg.waitForTimeout(350);
  };

  await t('it shows nothing at all until he turns it on', async () => {
    await show();
    if (await strip()) throw new Error('the band is on the board before he asked for it');
    const on = await pg.evaluate(() => Cal.on());
    if (on) throw new Error('Cal reports itself on by default');
  });

  await t('turning it on is one tap in Data & Setup', async () => {
    await pg.evaluate(() => { go('data'); render(); });
    await pg.waitForTimeout(400);
    const there = await pg.evaluate(() => !!document.querySelector('[data-action="cal-on"]'));
    if (!there) throw new Error('no way to switch it on');
    await pg.click('[data-action="cal-on"]'); await pg.waitForTimeout(300);
    const on = await pg.evaluate(() => Cal.on() && Store.data.settings.calOn === true);
    if (!on) throw new Error('it did not come on');
  });

  await t('his appointments show on the day, with their real titles', async () => {
    await setCal('ok', [
      { id:'e1', cal:'primary', calName:'Daryl', title:'Dentist',
        date: today, start:'14:00', end:'15:00', allDay:false }
    ]);
    await kick();
    const s = await strip();
    if (!s) throw new Error('no band on the board');
    if (!/Dentist/.test(s.text)) throw new Error('the title is not shown: ' + s.text);
    if (!/2pm/.test(s.text)) throw new Error('the time is not shown: ' + s.text);
  });

  await t('a job card and an appointment never look alike', async () => {
    const r = await pg.evaluate(() => {
      const p = document.querySelector('.pcal .pc-ev');
      const j = document.querySelector('.minicard, .jobcard');
      if (!p) return { err:'no appointment on screen' };
      if (!j) return { err:'no job card on screen, so there is nothing to compare against' };
      const bg = el => getComputedStyle(el).backgroundColor;
      return { personal: bg(p), job: bg(j), pcls: p.className, jcls: j.className };
    });
    if (r.err) throw new Error(r.err);
    if (r.personal === r.job)
      throw new Error('both are drawn the same colour: ' + r.personal);
    if (/jobcard|minicard/.test(r.pcls)) throw new Error('an appointment is wearing a job class');
  });

  await t('the Work calendar never comes back as a personal event', async () => {
    await setCal('ok', [
      { id:'w1', cal:'work@g', calName:'Work', title:'Drain Cleaning — Deanna',
        date: today, start:'08:00', end:'10:00', allDay:false },
      { id:'e2', cal:'primary', calName:'Daryl', title:'Haircut',
        date: today, start:'16:00', end:'16:30', allDay:false }
    ]);
    await kick();
    const s = await strip();
    if (/Deanna|Drain Cleaning/.test(s.text))
      throw new Error('a job came back round as a personal event: ' + s.text);
    if (!/Haircut/.test(s.text)) throw new Error('the real appointment went missing: ' + s.text);
  });

  await t('nor does anything still carrying the sync’s own tag', async () => {
    await setCal('ok', [
      { id:'t1', cal:'primary', calName:'Daryl', title:'Water Heater — Baker',
        date: today, start:'08:00', end:'10:00', allDay:false, poseidon_job_id:'job_1' },
      { id:'e3', cal:'primary', calName:'Daryl', title:'Physio',
        date: today, start:'11:00', end:'12:00', allDay:false }
    ]);
    await kick();
    const s = await strip();
    if (/Baker|Water Heater/.test(s.text))
      throw new Error('a tagged job event was shown as personal: ' + s.text);
    if (!/Physio/.test(s.text)) throw new Error('lost the real one: ' + s.text);
  });

  /* ---- the one that matters ---- */
  await t('an unreachable calendar is never shown as free', async () => {
    await setCal('error');
    await kick();
    const s = await strip();
    if (!s) throw new Error('a failure left no band at all, so the board looks complete');
    if (/Nothing of your own/i.test(s.text))
      throw new Error('a failure was reported as an empty day: ' + s.text);
    if (!/couldn.t read your calendar/i.test(s.text))
      throw new Error('it does not say it failed: ' + s.text);
    if (!/don.t take an empty slot as free/i.test(s.text))
      throw new Error('it does not warn him off the empty slots: ' + s.text);
  });

  await t('and it says what Google said, not just that something broke', async () => {
    const s = await strip();
    if (!/stopped accepting the saved permission/i.test(s.text))
      throw new Error('the reason is missing: ' + s.text);
  });

  await t('a failure offers to try again rather than needing a reload', async () => {
    const there = await pg.evaluate(() => !!document.querySelector('[data-action="cal-retry"]'));
    if (!there) throw new Error('no way to retry');
  });

  await t('a dropped connection is a failure too, not an empty day', async () => {
    await setCal('dead');
    await kick();
    const s = await strip();
    if (!s || /Nothing of your own/i.test(s.text))
      throw new Error('a dead connection read as a clear day: ' + (s && s.text));
    if (!/couldn.t read your calendar/i.test(s.text)) throw new Error('got: ' + s.text);
  });

  await t('Google not being set up yet says so plainly', async () => {
    await setCal('setup');
    await kick();
    const s = await strip();
    if (!/isn.t connected yet/i.test(s.text)) throw new Error('got: ' + (s && s.text));
    if (/Nothing of your own/i.test(s.text)) throw new Error('read as an empty day');
  });

  await t('a genuinely clear day is allowed to say so', async () => {
    await setCal('ok', []);
    await kick();
    const s = await strip();
    if (!/Nothing of your own on today/i.test(s.text))
      throw new Error('a known-clear day should say so: ' + (s && s.text));
  });

  await t('it does not hammer the calendar on every repaint', async () => {
    await setCal('ok', [{ id:'e9', cal:'primary', calName:'Daryl', title:'Gym',
      date: today, start:'06:00', end:'07:00', allDay:false }]);
    await kick();
    const before = await pg.evaluate(() => Cal._seq);
    for (let i=0;i<4;i++){ await pg.evaluate(() => render()); await pg.waitForTimeout(90); }
    const after = await pg.evaluate(() => Cal._seq);
    if (after !== before) throw new Error('four repaints caused ' + (after-before) + ' more fetches');
  });

  await t('nor retry a failed window over and over', async () => {
    await setCal('error');
    await kick();
    const before = await pg.evaluate(() => Cal._seq);
    for (let i=0;i<4;i++){ await pg.evaluate(() => render()); await pg.waitForTimeout(90); }
    const after = await pg.evaluate(() => Cal._seq);
    if (after !== before) throw new Error('a failed window was retried ' + (after-before) + ' times');
  });

  /* ---- clashes ---- */
  await t('booking over an appointment warns him and names it', async () => {
    await setCal('ok', [{ id:'c1', cal:'primary', calName:'Daryl', title:'Dentist',
      date: today, start:'14:00', end:'15:00', allDay:false }]);
    await kick();
    await pg.evaluate(() => openJobForm(null)); await pg.waitForTimeout(400);
    const r = await pg.evaluate(t2 => {
      document.querySelector('#f-date').value = t2;
      document.querySelector('#f-date').dispatchEvent(new Event('change'));
      const w = document.querySelector('#f-window');
      w.value = '2:00–4:00'; w.dispatchEvent(new Event('change'));
      const wrap = document.querySelector('#f-clash-wrap');
      return { shown: wrap && wrap.style.display !== 'none',
               text: document.querySelector('#f-clash').innerText };
    }, today);
    if (!r.shown) throw new Error('no warning on a slot that collides');
    if (!/Dentist/.test(r.text)) throw new Error('it does not name it: ' + r.text);
  });

  await t('and it still lets him book it', async () => {
    const blocked = await pg.evaluate(() =>
      !!document.querySelector('[data-save-job]').disabled);
    if (blocked) throw new Error('a clash stopped him booking — it is a warning, not a veto');
  });

  await t('a slot that misses it says nothing', async () => {
    const r = await pg.evaluate(() => {
      const w = document.querySelector('#f-window');
      w.value = '8:00–10:00'; w.dispatchEvent(new Event('change'));
      return document.querySelector('#f-clash-wrap').style.display;
    });
    if (r !== 'none') throw new Error('it warned about a slot hours away');
  });

  await t('an afternoon slot is read as the afternoon, not the morning', async () => {
    const r = await pg.evaluate(() => [
      Cal.windowSpan('2:00–4:00'), Cal.windowSpan('8:00–10:00'),
      Cal.windowSpan('12:00–2:00'), Cal.windowSpan('Anytime')
    ]);
    if (r[0].s !== 14*60 || r[0].e !== 16*60) throw new Error('2-4 read as ' + JSON.stringify(r[0]));
    if (r[1].s !== 8*60) throw new Error('8-10 read as ' + JSON.stringify(r[1]));
    if (r[2].s !== 12*60 || r[2].e !== 14*60) throw new Error('12-2 read as ' + JSON.stringify(r[2]));
    if (r[3] !== null) throw new Error('Anytime was given a span');
  });

  await t('a day away collides with every slot, including Anytime', async () => {
    await pg.evaluate(() => closeModal());
    await setCal('ok', [{ id:'a1', cal:'primary', calName:'Daryl', title:'Calgary wedding',
      date: today, start:null, end:null, allDay:true }]);
    await kick();
    const r = await pg.evaluate(t2 => ({
      morning: Cal.clashes(t2, '8:00–10:00').length,
      anytime: Cal.clashes(t2, 'Anytime').length,
      label:   Cal.evLabel(Cal.forDate(t2)[0])
    }), today);
    if (!r.morning) throw new Error('an all-day event missed the morning slot');
    if (!r.anytime) throw new Error('an all-day event missed Anytime');
    if (!/all day/i.test(r.label)) throw new Error('it does not say all day: ' + r.label);
  });

  await t('a day it could not read never reports a clash either way', async () => {
    await setCal('error');
    await kick();
    const n = await pg.evaluate(t2 => Cal.clashes(t2, '8:00–10:00').length, today);
    if (n !== 0) throw new Error('it invented ' + n + ' clashes from a failed read');
    const knows = await pg.evaluate(t2 => Cal.knows(t2), today);
    if (knows) throw new Error('it claims to know a day it could not read');
  });

  /* ---- nothing personal is kept ---- */
  await t('no appointment is ever written into the shop or the browser', async () => {
    await setCal('ok', [{ id:'p1', cal:'primary', calName:'Daryl', title:'Marriage counselling',
      date: today, start:'09:00', end:'10:00', allDay:false }]);
    await kick();
    const r = await pg.evaluate(() => {
      Store.save();
      const shop = JSON.stringify(Store.data);
      let ls = '';
      for (let i=0;i<localStorage.length;i++) ls += localStorage.getItem(localStorage.key(i));
      return { inShop: shop.indexOf('Marriage counselling') >= 0,
               inLocal: ls.indexOf('Marriage counselling') >= 0,
               onScreen: document.body.innerText.indexOf('Marriage counselling') >= 0 };
    });
    if (r.inShop) throw new Error('it was written into the shop, which syncs to Supabase');
    if (r.inLocal) throw new Error('it was written into localStorage');
    if (!r.onScreen) throw new Error('it is not even on screen, so this proves nothing');
  });

  await t('and nothing personal reaches the row stored on the server', async () => {
    await pg.evaluate(() => Cloud.syncNow().catch(() => null));
    await pg.waitForTimeout(300);
    const st = await fetch(URL_+'/__state').then(r=>r.json());
    const blob = JSON.stringify(st.shops || {});
    // Prove the row is really there before concluding anything from its absence.
    if (!/\"jobs\"/.test(blob))
      throw new Error('no shop on the server to check \u2014 this test proves nothing');
    if (blob.indexOf('Marriage counselling') >= 0)
      throw new Error('a personal appointment reached the synced row');
  });

  await t('a calendar he switches off stops showing', async () => {
    await setCal('ok', [
      { id:'k1', cal:'primary', calName:'Daryl',  title:'Physio',
        date: today, start:'09:00', end:'10:00', allDay:false },
      { id:'k2', cal:'kids@g',   calName:'Kids',  title:"Hockey practice",
        date: today, start:'17:00', end:'18:00', allDay:false }
    ], [{ id:'primary', name:'Daryl', excluded:false },
        { id:'kids@g',  name:'Kids',  excluded:false },
        { id:'work@g',  name:'Work',  excluded:true }]);
    await kick();
    let s = await strip();
    if (!/Hockey practice/.test(s.text)) throw new Error('setup: the kids calendar is not showing');
    await pg.evaluate(() => { Cal.toggle('kids@g'); renderQuiet(); });
    await pg.waitForTimeout(300);
    s = await strip();
    if (/Hockey practice/.test(s.text)) throw new Error('a hidden calendar still shows: ' + s.text);
    if (!/Physio/.test(s.text)) throw new Error('hiding one hid the others too: ' + s.text);
  });

  await t('that choice survives a reload, and the Work calendar is not offered', async () => {
    await pg.reload(); await pg.waitForTimeout(600);
    const r = await pg.evaluate(() => ({ hidden: Cal.hidden(), on: Store.data.settings.calOn }));
    if (r.hidden.indexOf('kids@g') < 0) throw new Error('the hidden calendar came back: ' + JSON.stringify(r));
    if (!r.on) throw new Error('it switched itself off across a reload');
    await pg.evaluate(() => { go('data'); render(); }); await pg.waitForTimeout(500);
    const offered = await pg.evaluate(() =>
      Array.from(document.querySelectorAll('[data-cal-toggle]')).map(e => e.dataset.calToggle));
    if (offered.indexOf('work@g') >= 0) throw new Error('the Work calendar is offered as a choice');
  });

  /* The week board marks which days have something of his own on them, so he
     does not have to read the band to know Thursday is spoken for. */
  const weekDots = async () => {
    await pg.evaluate(() => { App.search=''; go('schedule'); App.scheduleMode='week'; render(); });
    await pg.waitForTimeout(450);
    return pg.evaluate(() => Array.from(document.querySelectorAll('.wt-day')).map(el => ({
      day: (el.querySelector('.dd') || {}).textContent,
      dot: !!el.querySelector('.pdot'),
      title: el.getAttribute('title') || ''
    })));
  };

  await t('a week day with something of his own gets a dot', async () => {
    await pg.evaluate(() => { Store.data.settings.calOn = true; Store.save(); });
    await setCal('ok', [{ id:'w1', cal:'primary', calName:'Daryl', title:'Trent - 12 Labours',
      date: today, start:'19:00', end:'19:30', allDay:false }]);
    await pg.evaluate(() => { Cal.state='off'; Cal._failed=null; Cal.events=[]; });
    const rows = await weekDots();
    const d = String(Number(today.slice(8)));
    const mine = rows.find(r => r.day === d);
    if (!mine) throw new Error('today is not on the week board: ' + JSON.stringify(rows));
    if (!mine.dot) throw new Error('no dot on a day that has an appointment');
    if (!/Trent/.test(mine.title))
      throw new Error('hovering the day does not name it: ' + mine.title);
  });

  await t('and the other days do not', async () => {
    const rows = await weekDots();
    const d = String(Number(today.slice(8)));
    const others = rows.filter(r => r.day !== d);
    if (!others.length) throw new Error('only one day on the board');
    if (others.some(r => r.dot))
      throw new Error('a day with nothing on it was marked: ' + JSON.stringify(others));
  });

  await t('a week it could not read is not marked as empty by silence', async () => {
    await setCal('error');
    await pg.evaluate(() => { Cal.state='off'; Cal._failed=null; Cal.events=[]; });
    const rows = await weekDots();
    if (rows.some(r => r.dot))
      throw new Error('dots drawn from a failed read');
    const band = await pg.evaluate(() => {
      const el = document.querySelector('.pcal');
      return el ? el.innerText : null;
    });
    if (!band || !/couldn.t read your calendar/i.test(band))
      throw new Error('no failure band, so missing dots read as a clear week: ' + band);
  });

  await t('the dot is small enough not to read as another technician', async () => {
    await setCal('ok', [{ id:'w2', cal:'primary', calName:'Daryl', title:'Physio',
      date: today, start:'09:00', end:'10:00', allDay:false }]);
    await pg.evaluate(() => { Cal.state='off'; Cal._failed=null; Cal.events=[]; });
    await weekDots();
    const r = await pg.evaluate(() => {
      const dot = document.querySelector('.wt-day .pdot');
      const av  = document.querySelector('.wt-tech .avatar');
      if (!dot || !av) return { err: 'missing ' + (!dot ? 'dot' : 'avatar') };
      return { dot: dot.getBoundingClientRect().width, av: av.getBoundingClientRect().width };
    });
    if (r.err) throw new Error(r.err);
    if (!(r.dot > 0 && r.dot < r.av / 2))
      throw new Error('dot is ' + r.dot + 'px against a ' + r.av + 'px avatar');
  });

  /* The month answers "which days have something", the day answers "what".
     A green dot is the prompt to click, and clicking lands on that day with
     the band at the top naming it. */
  const monthDots = async () => {
    await pg.evaluate(() => { App.search=''; go('schedule'); App.scheduleMode='month'; render(); });
    await pg.waitForTimeout(500);
    return pg.evaluate(() => Array.from(document.querySelectorAll('.mo-cell')).map(el => ({
      day: (el.querySelector('.dnum') || {}).textContent,
      date: el.dataset.goday,
      dot: !!el.querySelector('.pdot'),
      title: el.getAttribute('title') || ''
    })));
  };

  await t('the month marks the days that have something on them', async () => {
    await pg.evaluate(() => { Store.data.settings.calOn = true; Store.save(); });
    await setCal('ok', [{ id:'m1', cal:'primary', calName:'Daryl', title:'Trent - 12 Labours',
      date: today, start:'19:00', end:'19:30', allDay:false }]);
    await pg.evaluate(() => { Cal.state='off'; Cal._failed=null; Cal.events=[]; });
    const cells = await monthDots();
    const mine = cells.find(c => c.date === today);
    if (!mine) throw new Error('today is not on the month grid');
    if (!mine.dot) throw new Error('no dot on the day that has an appointment');
    if (!/Trent/.test(mine.title)) throw new Error('hovering it says nothing: ' + mine.title);
    const others = cells.filter(c => c.date !== today);
    if (others.some(c => c.dot))
      throw new Error('a day with nothing on it was marked');
  });

  await t('clicking a marked day opens that day, where the band says what it is', async () => {
    // the cell's middle holds job cards, which open the job; the date number
    // is the part of the cell he actually taps to open the day
    await pg.evaluate(() => closeModal());
    await pg.click(`.mo-cell[data-goday="${today}"] .dnum`);
    await pg.waitForTimeout(500);
    const r = await pg.evaluate(() => ({
      mode: App.scheduleMode, date: App.date,
      band: (document.querySelector('.pcal') || {}).innerText || ''
    }));
    if (r.mode !== 'day') throw new Error('it did not switch to the day view: ' + r.mode);
    if (r.date !== today) throw new Error('it opened ' + r.date);
    if (!/Trent/.test(r.band))
      throw new Error('the day does not say what is on: ' + r.band);
  });

  await t('a month it could not read draws no dots, and says so', async () => {
    await setCal('error');
    await pg.evaluate(() => { Cal.state='off'; Cal._failed=null; Cal.events=[]; });
    const cells = await monthDots();
    if (cells.some(c => c.dot)) throw new Error('dots drawn from a failed read');
    const band = await pg.evaluate(() => (document.querySelector('.pcal') || {}).innerText || '');
    if (!/couldn.t read your calendar/i.test(band))
      throw new Error('a blank month with no warning reads as a clear month: ' + band);
  });

  await t('and once it reads, the month is dots alone \u2014 no band in the way', async () => {
    await setCal('ok', [{ id:'m2', cal:'primary', calName:'Daryl', title:'Physio',
      date: today, start:'09:00', end:'10:00', allDay:false }]);
    await pg.evaluate(() => { Cal.state='off'; Cal._failed=null; Cal.events=[]; });
    await monthDots();
    const band = await pg.evaluate(() => !!document.querySelector('.pcal'));
    if (band) throw new Error('the band is still taking up room on the month');
    const dotted = await pg.evaluate(() => document.querySelectorAll('.mo-cell .pdot').length);
    if (dotted !== 1) throw new Error(dotted + ' dots, wanted 1');
  });

  await t('one fetch covers the month, the weeks and the days inside it', async () => {
    const before = await pg.evaluate(() => Cal._seq);
    await pg.evaluate(() => { App.scheduleMode='week'; render(); });
    await pg.waitForTimeout(250);
    await pg.evaluate(() => { App.scheduleMode='day'; render(); });
    await pg.waitForTimeout(250);
    await pg.evaluate(() => { App.scheduleMode='month'; render(); });
    await pg.waitForTimeout(250);
    const after = await pg.evaluate(() => Cal._seq);
    if (after !== before)
      throw new Error('flipping views cost ' + (after-before) + ' more fetches');
  });

  await t('turning it off clears what it was holding', async () => {
    await pg.evaluate(() => { go('data'); render(); }); await pg.waitForTimeout(450);
    await pg.click('[data-action="cal-off"]'); await pg.waitForTimeout(300);
    const r = await pg.evaluate(() => ({ n: Cal.events.length, state: Cal.state, on: Cal.on() }));
    if (r.n) throw new Error(r.n + ' appointments left in memory after switching off');
    if (r.on) throw new Error('it is still reporting itself on');
    await show();
    if (await strip()) throw new Error('the band is still on the board');
  });

  await b.close();
  if (errs.length){
    console.log('\n' + errs.length + ' problem(s)');
    errs.forEach(e => console.log('  - ' + e));
    process.exit(1);
  }
  console.log('\nall good');
})();
