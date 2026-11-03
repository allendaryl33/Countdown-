const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const pg = await b.newPage({ viewport:{width:1400,height:1000}, deviceScaleFactor:2 });
  pg.on('pageerror',e=>console.log('PAGEERROR '+e.message));
  await fetch('http://127.0.0.1:54321/__reset');
  await pg.goto('http://127.0.0.1:54321/index.html'); await pg.waitForTimeout(400);

  const shot = async (name, clip) => {
    await pg.evaluate(() => { go('data');
      const c = [...document.querySelectorAll('.card-head h3')].find(h=>/Sync across/.test(h.textContent));
      if (c) c.closest('.card').scrollIntoView({block:'center'});
    });
    await pg.waitForTimeout(450);
    const box = await pg.evaluate(() => {
      const c = [...document.querySelectorAll('.card-head h3')].find(h=>/Sync across/.test(h.textContent));
      const r = c.closest('.card').getBoundingClientRect();
      return { x:Math.max(0,r.x-14), y:Math.max(0,r.y-14), width:r.width+28, height:r.height+28 };
    });
    await pg.screenshot({ path: process.env.SP + '/shots/cloud-' + name + '.png', clip: box });
  };

  await shot('1-disconnected');
  await pg.evaluate(() => {
    Cloud.cfg = { url:'http://127.0.0.1:54321', key:'sb_publishable_test', email:'', deviceId:'iPhone-k3f9x' };
    Cloud.saveCfg(); Cloud.set('signed-out','now sign in'); render();
  });
  await shot('2-signin');
  await pg.evaluate(() => Cloud.signIn('allen@example.com','correct-horse').then(()=>Cloud.syncNow()));
  await pg.waitForTimeout(900);
  await pg.evaluate(() => render());
  await shot('3-synced');

  // conflict
  await pg.evaluate(() => { Store.data.customers[2].name='A offline edit'; Store.saveLocal(); Cloud.dirty=true; });
  await fetch('http://127.0.0.1:54321/__poison');
  await pg.evaluate(() => Cloud.syncNow());
  await pg.waitForTimeout(700);
  await pg.screenshot({ path: process.env.SP + '/shots/cloud-4-conflict.png' });
  await b.close(); console.log('shots done');
})();
