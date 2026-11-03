const { chromium } = require(process.env.PW || 'playwright-core');
const APP='http://127.0.0.1:54321/index.html', URL_='http://127.0.0.1:54321', KEY='sb_publishable_test';
const rows = [
 { id:1, name:'Bruce Hanlan', contact:'780-555-0142', service:'Water Heater',
   description:"No hot water since last night. 50 gal gas unit in the basement, maybe 12 years old.",
   timing:'Weekday afternoons, not Tuesdays', source:'website', status:'new', created_at:'2026-10-26T18:04:00Z' },
 { id:2, name:'Priya Raman', contact:'priya.raman@example.com', service:'Drain Cleaning',
   description:'Kitchen sink backing up, plunger is not touching it.',
   timing:'Any evening after 5', source:'website', status:'new', created_at:'2026-10-27T01:20:00Z' }];
(async () => {
  await fetch(URL_+'/__reset');
  await fetch(URL_+'/__inq', { method:'POST', body: JSON.stringify({ rows, mode:'ok' }) });
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  for (const [name, vp] of [['leads-desktop',{width:1280,height:1000}], ['leads-phone',{width:390,height:844}]]){
    const pg = await b.newPage({ viewport: vp });
    await pg.goto(APP); await pg.waitForTimeout(400);
    await pg.evaluate(([u,k]) => { Cloud.cfg={url:u,key:k,email:'',deviceId:'shot'}; Cloud.saveCfg();
      return Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()); }, [URL_,KEY]);
    await pg.waitForTimeout(900);
    await pg.evaluate(() => { App.view='leads'; render(); }); await pg.waitForTimeout(400);
    await pg.screenshot({ path: process.env.SP+'/shots/'+name+'.png', fullPage: vp.width < 500 });
    await pg.close();
  }
  await b.close(); console.log('shot');
})();
