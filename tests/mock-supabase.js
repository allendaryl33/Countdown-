/* A stand-in for Supabase: the handful of REST endpoints the app actually
   uses, with the same auth and the same rev guard. Lets the sync logic be
   tested without an account. Also serves index.html so fetch has an origin. */
/* Paths resolve from this file, so the suites run wherever the repo is
   checked out. APP_DIR overrides it. Named REPO_DIR, not APP: sixty of
   these already use APP for the app's URL. */
const REPO_DIR = process.env.APP_DIR || require('path').join(__dirname, '..');
const http = require('http'); const fs = require('fs'); const url = require('url');

const USERS = { 'allen@example.com': { pw:'correct-horse', id:'user-1' } };
const KEY = 'sb_publishable_test';
let shops = {};            // owner -> { owner, data, rev, device, updated_at }
// The website's own table, exactly the columns Victor reported.
let inquiries = [];
let inqMode = 'ok';        // 'ok' | 'missing' | 'denied'
/* Stands in for the personal-calendar Edge Function. calMode picks what
   Google would do: answer, fail, be unconfigured, or never reply at all. */
let calMode = 'ok';        // 'ok' | 'error' | 'setup' | 'dead' | 'unauth'
let calEvents = [];
let calCals = [{ id:'primary', name:'Daryl', excluded:false },
               { id:'work@g',  name:'Work',  excluded:true }];
let links = [];            // estimate_links rows
let invLinks = [];         // invoice_links rows
let history = [];
let tokens = {};           // access -> owner
let objects = {};          // "bucket/path" -> { owner, bytes, type }
let signed = {};           // token -> "bucket/path"
let refresh = {};          // refresh -> owner

const reset = () => { shops = {}; history = []; tokens = {}; refresh = {}; objects = {}; signed = {};
  inquiries = []; inqMode = 'ok'; links = []; invLinks = [];
  calMode = 'ok'; calEvents = [];
  calCals = [{ id:'primary', name:'Daryl', excluded:false },
             { id:'work@g',  name:'Work',  excluded:true }]; };
const json = (res, code, body, extra) => {
  res.writeHead(code, Object.assign({
    'Content-Type':'application/json',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'*',
    'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Expose-Headers':'*'
  }, extra||{}));
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const mint = owner => {
  const a = 'acc-'+Math.random().toString(36).slice(2);
  const r = 'ref-'+Math.random().toString(36).slice(2);
  tokens[a] = owner; refresh[r] = owner;
  return { access_token:a, refresh_token:r, token_type:'bearer', expires_in:3600,
           user:{ id:owner, email:Object.keys(USERS).find(e=>USERS[e].id===owner) } };
};

const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  if (req.method === 'OPTIONS') return json(res, 204);

  if (u.pathname === '/__reset'){ reset(); return json(res, 200, { ok:true }); }

  /* Tests set the scenario here, then the app calls the function below. */
  if (u.pathname === '/__cal'){
    let raw = ''; req.on('data', c => raw += c);
    return req.on('end', () => {
      let b = {}; try { b = JSON.parse(raw || '{}'); } catch(e){}
      if (b.mode) calMode = b.mode;
      if (Array.isArray(b.events)) calEvents = b.events;
      if (Array.isArray(b.calendars)) calCals = b.calendars;
      json(res, 200, { ok:true, mode:calMode, events:calEvents.length });
    });
  }
  if (u.pathname === '/functions/v1/personal-calendar'){
    // No token at all must not read anybody's calendar: the real function is
    // deployed with jwt verification on, and the platform rejects it first.
    const bearer = (req.headers['authorization']||'').replace(/^Bearer /,'');
    if (calMode === 'unauth' || !bearer || !tokens[bearer])
      return json(res, 401, { message:'Missing authorization header' });
    if (calMode === 'dead'){ res.destroy(); return; }
    if (calMode === 'setup')
      return json(res, 200, { ok:false, setup:true,
        error:"Google isn't connected yet. The three GOOGLE_ secrets aren't set on this function." });
    if (calMode === 'error')
      return json(res, 200, { ok:false, reauth:true,
        error:'Google has stopped accepting the saved permission. It needs granting again.' });
    const from = u.query.from || '', to = u.query.to || from;
    // The real one excludes the Work calendar by name and drops anything
    // still carrying the sync's own tag; both are mirrored here.
    const hidden = calCals.filter(c => c.excluded).map(c => c.id);
    const evs = calEvents
      .filter(e => !e.poseidon_job_id)
      .filter(e => hidden.indexOf(e.cal) < 0)
      .filter(e => e.date >= from && e.date <= to);
    return json(res, 200, { ok:true, zone:'America/Edmonton', from, to,
                            calendars: calCals, events: evs });
  }
  // the inquiry-photos bucket: sign and serve, so the app can show them
  if (u.pathname.startsWith('/storage/v1/object/sign/inquiry-photos/')){
    const key = u.pathname.replace('/storage/v1/object/sign/inquiry-photos/','');
    return json(res, 200, { signedURL: '/object/inqdl/' + key + '?token=t' });
  }
  if (u.pathname.startsWith('/storage/v1/object/inqdl/')){
    // a 1x1 png, enough for the browser to decode and paint
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64');
    res.writeHead(200, {'Content-Type':'image/png','Content-Length':png.length});
    return res.end(png);
  }
  if (u.pathname === '/__stripe-paid'){   // what the Edge Function would write
    let body=''; req.on('data',d=>body+=d);
    return req.on('end',()=>{ const q = body ? JSON.parse(body) : {};
      const l = invLinks.find(x => x.token === q.token);
      if (!l) return json(res, 404, { ok:false });
      l.paid_at = new Date().toISOString();
      l.paid_amount = q.amount; l.paid_ref = q.ref || 'pi_test';
      json(res, 200, { ok:true });
    });
  }
  if (u.pathname === '/__expire'){   // age every signing link past its expiry
    links.forEach(l => { l.expires_at = new Date(Date.now() - 86400000).toISOString(); });
    return json(res, 200, { ok:true, n: links.length });
  }
  if (u.pathname === '/__inq'){        // seed the website's table for a test
    let body=''; req.on('data',d=>body+=d);
    return req.on('end',()=>{ const b = body ? JSON.parse(body) : {};
      if (Array.isArray(b.rows)) inquiries = b.rows;
      if (b.mode) inqMode = b.mode;
      json(res, 200, { ok:true, n: inquiries.length, mode: inqMode }); });
  }
  if (u.pathname === '/__state') return json(res, 200, {
    shops, history: history.length,
    objects: Object.keys(objects).reduce((o,k) => (o[k] = objects[k].bytes, o), {}) });
  if (u.pathname === '/__poison'){ // simulate another device writing
    const o = 'user-1';
    if (shops[o]){ history.push(shops[o]);
      const data = JSON.parse(JSON.stringify(shops[o].data));
      data.__from = 'other device';
      /* ?set=settings.notes&to=... — the other device changed that exact
         field too, so a merge has a real clash to ask about. Dotted path;
         numbers index arrays. */
      const path = u.query && u.query.set;
      if (path){
        const keys = path.split('.');
        let at = data;
        keys.slice(0, -1).forEach(k => { at = at[/^\d+$/.test(k) ? Number(k) : k]; });
        const last = keys[keys.length - 1];
        at[/^\d+$/.test(last) ? Number(last) : last] = u.query.to;
      }
      shops[o] = Object.assign({}, shops[o], { rev: shops[o].rev + 1,
        device:'OtherPhone-zzz', updated_at:new Date().toISOString(), data }); }
    return json(res, 200, shops[o] || null);
  }

  /* Any sign-baked*.html, so a second suite can bake its own copy instead of
     two of them writing over one filename. */
  if (/^\/sign-baked[\w-]*\.html$/.test(u.pathname)){
    const dir = process.env.SP_DIR || process.env.SP || __dirname;
    try {
      const body = fs.readFileSync(dir + u.pathname);
      res.writeHead(200, {'Content-Type':'text/html'});
      return res.end(body);
    } catch(err){
      res.writeHead(404, {'Content-Type':'text/plain'});
      return res.end('no ' + u.pathname + ' in ' + dir);
    }
  }
  if (u.pathname === '/invoice.html'){
    res.writeHead(200, {'Content-Type':'text/html'});
    return res.end(fs.readFileSync(`${REPO_DIR}/invoice.html`));
  }
  if (u.pathname === '/sign.html'){
    res.writeHead(200, {'Content-Type':'text/html'});
    return res.end(fs.readFileSync(`${REPO_DIR}/sign.html`));
  }
  if (u.pathname === '/index.html' || u.pathname === '/'){
    res.writeHead(200, {'Content-Type':'text/html'});
    return res.end(fs.readFileSync(`${REPO_DIR}/index.html`));
  }
  // sw.js among them: the real host serves it next to index.html, and
  // without it every page logs a failed registration
  if (/^\/[\w.-]+\.(png|json|ico|js)$/.test(u.pathname)){
    const f = REPO_DIR + u.pathname;
    if (fs.existsSync(f)){
      const type = u.pathname.endsWith('.json') ? 'application/json'
                 : u.pathname.endsWith('.js')   ? 'text/javascript'
                 : 'image/png';
      res.writeHead(200, {'Content-Type': type, 'Service-Worker-Allowed': '/'});
      return res.end(fs.readFileSync(f));
    }
  }

  const key = req.headers['apikey'];
  if (u.pathname.startsWith('/auth') || u.pathname.startsWith('/rest')){
    if (key !== KEY) return json(res, 401, { message:'Invalid API key' });
    if ((req.headers['authorization']||'').includes(KEY))
      return json(res, 401, { message:'Invalid JWT' });   // key must not be Bearer
  }

  // ---- storage: signed reads need no auth header, the token is the auth
  const sig = u.pathname.match(/^\/storage\/v1\/object\/sign\/(.+)$/);
  if (sig && req.method === 'GET'){
    const want = signed[(u.query.token || '')];
    if (!want || want !== sig[1]) return json(res, 400, { message:'Invalid signature' });
    const o = objects[want];
    if (!o) return json(res, 404, { message:'Not found' });
    res.writeHead(200, {'Content-Type': o.type, 'Access-Control-Allow-Origin':'*'});
    return res.end(o.buf);
  }

  if (u.pathname.startsWith('/storage/v1/')){
    const owner = tokens[(req.headers['authorization']||'').replace(/^Bearer /,'')];
    if (key !== KEY) return json(res, 401, { message:'Invalid API key' });
    if (!owner) return json(res, 401, { message:'JWT expired' });

    // sign an existing object for reading
    const mk = u.pathname.match(/^\/storage\/v1\/object\/sign\/(.+)$/);
    if (mk && req.method === 'POST'){
      const full = mk[1];
      if (!objects[full]) return json(res, 404, { message:'Object not found' });
      if (objects[full].owner !== owner) return json(res, 403, { message:'Forbidden' });
      const tok = 'sg-' + Math.random().toString(36).slice(2);
      signed[tok] = full;
      return json(res, 200, { signedURL: '/object/sign/' + full + '?token=' + tok });
    }

    const mo = u.pathname.match(/^\/storage\/v1\/object\/(.+)$/);
    if (mo){
      const full = mo[1];
      if (req.method === 'POST' || req.method === 'PUT'){
        const chunks = [];
        req.on('data', d => chunks.push(d));
        return req.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (!buf.length) return json(res, 400, { message:'Empty body' });
          if (buf.length > 10485760) return json(res, 413, { message:'Payload too large' });
          objects[full] = { owner, bytes: buf.length, type: req.headers['content-type'] || 'image/jpeg', buf };
          json(res, 200, { Key: full });
        });
      }
      if (req.method === 'DELETE'){
        if (objects[full] && objects[full].owner !== owner)
          return json(res, 403, { message:'Forbidden' });
        delete objects[full];
        return json(res, 200, { message:'Successfully deleted' });
      }
    }
    return json(res, 404, { message:'not found' });
  }

  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    let b = null; try { b = body ? JSON.parse(body) : null; } catch(e){}

    if (u.pathname === '/auth/v1/token'){
      if (u.query.grant_type === 'password'){
        const rec = USERS[(b||{}).email];
        if (!rec || rec.pw !== b.password)
          return json(res, 400, { error:'invalid_grant', error_description:'Invalid login credentials' });
        return json(res, 200, mint(rec.id));
      }
      if (u.query.grant_type === 'refresh_token'){
        const owner = refresh[(b||{}).refresh_token];
        if (!owner) return json(res, 400, { error:'invalid_grant', error_description:'Invalid Refresh Token' });
        return json(res, 200, mint(owner));
      }
      return json(res, 400, { message:'bad grant' });
    }

    const auth = (req.headers['authorization']||'').replace(/^Bearer /,'');
    const owner = tokens[auth];

    // --- the two functions the customer's page may call, with no login ---
    if (u.pathname === '/rest/v1/rpc/invoice_for_viewing'){
      const q = b || {};
      const l = invLinks.find(x => x.token === q.p_token && new Date(x.expires_at) > new Date());
      return json(res, 200, l ? l.payload : null);
    }
    if (u.pathname === '/rest/v1/rpc/mark_invoice_viewed'){
      const q = b || {};
      const l = invLinks.find(x => x.token === q.p_token);
      if (l){ l.viewed_at = l.viewed_at || new Date().toISOString(); l.view_count = (l.view_count||0)+1; }
      return json(res, 200, null);
    }
    if (u.pathname === '/rest/v1/invoice_links'){
      if (!owner) return json(res, 401, { message:'JWT expired' });
      if (req.method === 'GET') return json(res, 200, invLinks.filter(l => l.owner === owner));
      if (req.method === 'POST'){
        invLinks.push(Object.assign({}, b, { created_at:new Date().toISOString(), view_count:0 }));
        return json(res, 201, []);
      }
      return json(res, 405, { message:'no' });
    }

    if (u.pathname === '/rest/v1/rpc/estimate_for_signing'){
      const q = b || {};
      const l = links.find(x => x.token === q.p_token && new Date(x.expires_at) > new Date());
      if (!l) return json(res, 200, null);
      return json(res, 200, { payload:l.payload, signed: !!l.signed_at,
                              signer_name:l.signer_name, signed_at:l.signed_at });
    }
    if (u.pathname === '/rest/v1/rpc/sign_estimate'){
      const q = b || {};
      if (!String(q.p_name||'').trim())
        return json(res, 200, { ok:false, reason:'name required' });
      if (!/^data:image\/png;base64,/.test(q.p_signature||'') || String(q.p_signature).length < 200)
        return json(res, 200, { ok:false, reason:'signature required' });
      const l = links.find(x => x.token === q.p_token &&
                                new Date(x.expires_at) > new Date() && !x.signed_at);
      if (!l) return json(res, 200, { ok:false, reason:'already signed, or the link has expired' });
      /* supabase-estimate-options.sql: one signature per estimate. An
         estimate can go out as two options, each its own link, and the
         customer's page promises her that approving one closes the others.
         The database is what makes that true rather than nearly true, so
         the mock has to model it or the suites would pass against a
         backend kinder than the real one. The same rule also covers a link
         that was re-sent, which could be signed twice before. */
      if (links.some(x => x.estimate_id === l.estimate_id &&
                          x.token !== l.token && x.signed_at))
        return json(res, 200, { ok:false, reason:'this estimate has already been approved' });
      l.signer_name = String(q.p_name).trim();
      l.signer_role = q.p_role || null;
      l.signature = q.p_signature;
      l.signed_at = new Date().toISOString();
      return json(res, 200, { ok:true });
    }

    // What really went in, rows and payloads, so a suite can assert on the
    // database rather than on the message the app happened to compose.
    if (u.pathname === '/__links') return json(res, 200, links);

    if (u.pathname === '/rest/v1/estimate_links'){
      if (!owner) return json(res, 401, { message:'JWT expired' });
      if (req.method === 'GET') return json(res, 200, links.filter(l => l.owner === owner));
      if (req.method === 'POST'){
        // PostgREST takes an array for a bulk insert, and an estimate with
        // options posts one row per option in a single call.
        const now = new Date().toISOString();
        (Array.isArray(b) ? b : [b]).forEach(r =>
          links.push(Object.assign({}, r, { created_at: now })));
        return json(res, 201, []);
      }
      return json(res, 405, { message:'no' });
    }

    if (u.pathname === '/rest/v1/inquiries'){
      if (!owner) return json(res, 401, { message:'JWT expired' });
      if (inqMode === 'missing')
        return json(res, 404, { message:'relation "public.inquiries" does not exist' });
      if (inqMode === 'denied')
        return json(res, 401, { message:'permission denied for table inquiries' });
      if (req.method !== 'GET') return json(res, 403, { message:'read only in this mock' });
      return json(res, 200, inquiries);
    }

    if (u.pathname === '/rest/v1/shops'){
      if (!owner) return json(res, 401, { message:'JWT expired' });

      if (req.method === 'GET'){
        const row = shops[owner];
        return json(res, 200, row ? [row] : []);
      }
      if (req.method === 'POST'){
        if (shops[owner]) return json(res, 409, { message:'duplicate key' });
        shops[owner] = { owner, data:b.data, rev:1, device:b.device,
                         updated_at:new Date().toISOString() };
        return json(res, 201, [shops[owner]]);
      }
      if (req.method === 'PATCH'){
        const row = shops[owner];
        const wantRev = (u.query.rev||'').replace('eq.','');
        if (!row) return json(res, 200, []);
        if (String(row.rev) !== wantRev) return json(res, 200, []);   // the guard
        history.push(row);
        shops[owner] = { owner, data:b.data, rev:b.rev, device:b.device,
                         updated_at:b.updated_at || new Date().toISOString() };
        return json(res, 200, [shops[owner]]);
      }
    }
    json(res, 404, { message:'not found' });
  });
});
server.listen(54321, () => console.log('mock supabase on http://127.0.0.1:54321'));
