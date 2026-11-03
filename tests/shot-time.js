/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it if the app lives elsewhere. */
const APP = process.env.APP_DIR || require('path').join(__dirname, '..');
const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const pg = await b.newPage({ viewport:{width:1480,height:1240}, deviceScaleFactor:2 });
  pg.on('pageerror',e=>console.log('PAGEERROR '+e.message));
  await pg.goto(`file://${APP}/index.html`); await pg.waitForTimeout(500);
  await pg.evaluate(() => {
    Store.data.settings.laborRate = 150;
    const rnd = () => Math.random().toString(36).slice(2,7);
    const mk = (type, hrs, price, daysAgo) => {
      const n = JSON.parse(JSON.stringify(Store.data.jobs[0]));
      n.id='J-'+rnd(); n.type=type; n.status='complete';
      n.scheduledDate = addDays(todayStr(), -daysAgo);
      n.parts=[{desc:'flat rate', qty:1, price}]; n.laborHours=0; n.laborRate=0;
      n.timeEntries=[{id:'e'+rnd(), startedAt:Date.now()-daysAgo*86400000,
        endedAt:Date.now()-daysAgo*86400000+hrs*3600000}];
      n.materialCost = Math.round(price * (type==='Water Heater' ? 0.55 : type==='Boiler / Radiant Heat' ? 0.3 : 0.12));
      Store.data.jobs.push(n);
    };
    Store.data.jobs.forEach(j => { j.status='scheduled'; j.timeEntries=[]; });
    const jitter = (h) => h * (0.8 + Math.random()*0.5);
    for (let i=0;i<9;i++)  mk('Drain Cleaning', jitter(1.6), 389, 4+i*9);
    for (let i=0;i<7;i++)  mk('Water Heater', jitter(4.5), 2250, 6+i*11);
    for (let i=0;i<5;i++)  mk('Leak Repair', jitter(2.2), 410, 9+i*14);
    for (let i=0;i<4;i++)  mk('Boiler / Radiant Heat', jitter(5.5), 690, 12+i*18);
    for (let i=0;i<6;i++)  mk('Gas Line', jitter(2), 520, 3+i*12);
    for (let i=0;i<3;i++)  mk('Sewer / Camera', jitter(1.2), 340, 20+i*16);
    Store.data.estimates.forEach((e,i) => {
      e.createdAt = Date.now() - (5 + i*7)*86400000;
      e.timeEntries = [{ id:'q'+i, startedAt:e.createdAt, endedAt:e.createdAt + (35+i*9)*60000 }];
      if (i % 3 === 2) e.status = 'declined';
    });
    Store.save(); go('timemoney');
  });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: process.env.SP + '/shots/time-money.png', fullPage:true });
  // running clock bar on Today
  await pg.evaluate(() => { Store.clockIn('job', Store.data.jobs[2].id);
    Store.running().entry.startedAt = Date.now() - 74*60000; Store.save(); go('today'); });
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: process.env.SP + '/shots/clockbar.png', clip:{x:0,y:0,width:1480,height:620} });
  // job record time panel
  const jid = await pg.evaluate(() => {
    const j = Store.data.jobs.find(x => x.status==='complete');
    Store.addEntry('job', j.id, Date.now()-2*86400000, Date.now()-2*86400000+95*60000, 'first trip — diagnosed');
    Store.addEntry('job', j.id, Date.now()-86400000, Date.now()-86400000+140*60000, 'back with the part');
    return j.id;
  });
  await pg.evaluate(id => openJob(id), jid); await pg.waitForTimeout(400);
  await pg.screenshot({ path: process.env.SP + '/shots/time-panel.png', fullPage:true });
  await b.close();
})();
