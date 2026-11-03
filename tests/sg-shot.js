const { chromium } = require(process.env.PW || 'playwright-core');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const body = fs.readFileSync(process.env.SP + '/supabase-guide.html','utf8');
  fs.writeFileSync(process.env.SP + '/sg-wrapped.html',
    '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">'
    + '<style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}</style></head><body>'
    + body + '</body></html>');
  for (const [name, vp, dark] of [['phone',{width:390,height:844},false],
                                  ['desk',{width:1000,height:1300},false],
                                  ['dark',{width:390,height:844},true]]){
    const pg = await b.newPage({ viewport:vp, deviceScaleFactor:2, colorScheme: dark?'dark':'light' });
    const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
    pg.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
    await pg.goto('file://' + process.env.SP + '/sg-wrapped.html');
    await pg.waitForTimeout(1100);
    const over = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const sqlLen = await pg.evaluate(() => document.getElementById('sql').textContent.length);
    await pg.screenshot({ path: process.env.SP + '/shots/sg-'+name+'.png' });
    console.log(name.padEnd(6), 'overflow=' + over, 'sqlChars=' + sqlLen, 'errors=' + (errs.join('|')||'none'));
    await pg.close();
  }
  await b.close();
})();
