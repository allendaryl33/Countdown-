const { chromium } = require('playwright');
const fs = require('fs');
const html = fs.readFileSync('life-dispatch.html','utf8');
fs.writeFileSync('_render.html', `<!doctype html><html><head><meta charset=utf8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>:root{color-scheme:light;box-sizing:border-box}body{margin:0;padding:0;font:14px -apple-system,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style>
</head><body>${html}</body></html>`);
const now = new Date();
const d = (off,h,m) => { const x=new Date(now); x.setDate(x.getDate()+off); x.setHours(h,m,0,0); return x; };
const ev = (id,summary,colorId,off,h,m,mins) => ({id,summary,colorId,status:'confirmed',
  start:{dateTime:d(off,h,m).toISOString()}, end:{dateTime:new Date(d(off,h,m).getTime()+mins*60000).toISOString()}});
// A work call-out landing on top of a life commitment: the exact case he described.
const events = [
  ev('e1','Prepare for the day','8',0,8,30,30),
  ev('e2','Marketing & sales','10',0,9,0,180),
  ev('w1','Emergency call-out — Glenora, no hot water','11',0,10,30,150),
  ev('e3','Lunch','7',0,12,0,60),
  ev('e4','Date night with Shiloh','4',1,18,0,150),
  ev('w2','Furnace install — Sherwood Park','11',1,19,0,120),
  ev('e5','Hockey','7',2,9,0,90),
  ev('e6','Church','9',6,10,0,90)
];
(async()=>{
  const b = await chromium.launch({args:['--no-sandbox']});
  for (const [name,w,h,scheme,range] of [['clash-day',1280,820,'light',2],['clash-week',1280,900,'light',7],['clash-phone',390,860,'light',2]]){
    const ctx = await b.newContext({viewport:{width:w,height:h},colorScheme:scheme});
    const pg = await ctx.newPage(); const errs=[];
    pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
    pg.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text());});
    await pg.addInitScript(([E,R])=>{
      try{ localStorage.setItem('life-dispatch/range',R); }catch(e){}
      const Ev=JSON.parse(E);
      window.claude={use:n=>Promise.resolve(n==='mcp'?{
        watchTool:(s,t,a,cb)=>{setTimeout(()=>cb({type:'data',result:{payload:t==='list_calendars'?{calendars:[{id:'darylyeg@gmail.com',summary:'darylyeg@gmail.com'}]}:{events:Ev},cache:{storedAt:Date.now()}}}),30);return()=>{};},
        callTool:()=>Promise.resolve({}),invalidate:()=>{}}:null)};
    },[JSON.stringify(events),String(range)]);
    await pg.goto('file://'+process.cwd()+'/_render.html');
    await pg.waitForTimeout(1300);
    const info = await pg.evaluate(()=>({
      scrollW:document.documentElement.scrollWidth, clientW:document.documentElement.clientWidth,
      stat:(document.getElementById('statline')||{}).textContent,
      clashRows:[...document.querySelectorAll('.row .clash, .wkev.clash')].length
    }));
    console.log(name, JSON.stringify(info));
    if(errs.length) console.log('  !!',errs.slice(0,4).join('\n   '));
    await pg.screenshot({path:name+'.png'});
    await ctx.close();
  }
  await b.close();
})();
