const { chromium } = require(process.env.PW || 'playwright-core');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  // wrap like the publish skeleton does
  const body = fs.readFileSync(process.env.SP + '/supabase-guide.html','utf8');
  const page = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">'
    + '<style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}</style></head><body>'
    + body + '</body></html>';
  fs.writeFileSync(process.env.SP + '/sg-wrapped.html', page);

  for (const [name, vp, dark] of [['desk',{width:1100,height:1200},false],
                                  ['phone',{width:390,height:844},false],
                                  ['dark',{width:1100,height:1200},true]]){
    const pg = await b.newPage({ viewport:vp, deviceScaleFactor:2,
      colorScheme: dark ? 'dark' : 'light' });
    const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
    pg.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
    await pg.goto('file://' + process.env.SP + '/sg-wrapped.html');
    await pg.waitForTimeout(1200);
    const over = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await pg.screenshot({ path: process.env.SP + '/shots/sg-'+name+'.png', fullPage: name==='phone' ? false : false });
    console.log(name.padEnd(6), 'overflow=' + over, 'errors=' + (errs.join('|')||'none'));
    if (name === 'desk'){
      // exercise a copy button's text extraction without the clipboard
      const svc = await pg.evaluate(() => {
        const btn = document.querySelector('[data-from="#svc"]');
        const src = document.querySelector('#svc');
        return Array.from(src.querySelectorAll('tbody tr')).length;
      });
      const counts = await pg.$$eval('[data-count]', e=>e.map(x=>x.textContent));
      console.log('       services=' + svc + ' counts=' + JSON.stringify(counts));
    }
    await pg.close();
  }
  await b.close();
})();
