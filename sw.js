/* Poseidon Dispatch — service worker.

   Two jobs, and deliberately no more.

   1. Receive the night-before push. A push cannot be scheduled from the
      phone; Supabase sends it, this wakes up and shows it.

   2. Fix updates. The installed app opens start_url "./" with no ?v=, so
      the only way a new version ever landed was deleting the app and
      adding it again — which also throws away the notification permission
      and the push subscription, and would quietly turn the reminders off.

   So the fetch handler is NETWORK-FIRST, never cache-first: online, the
   page is always whatever GitHub Pages is serving right now. The cache is
   a fallback for a basement with no signal, nothing else. Cache-first here
   would be how he ends up running last week's build without knowing. */

const CACHE = "poseidon-fallback-v1";
const SHELL = ["./", "./index.html", "./manifest.json", "./icon-180.png", "./icon-512.png"];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req, { cache: "no-store" });
      // keep the fallback current, but never serve it ahead of the network
      if (fresh && fresh.ok){
        const copy = fresh.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return fresh;
    } catch (_){
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === "navigate"){
        const page = await caches.match("./index.html");
        if (page) return page;
      }
      throw _;
    }
  })());
});

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_){ d = { body: e.data && e.data.text() }; }
  const title = d.title || "Poseidon Dispatch";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "You have jobs tomorrow that aren't confirmed yet.",
    icon: "./icon-180.png",
    badge: "./icon-180.png",
    tag: d.tag || "reminder",          // a second push replaces the first
    renotify: true,
    data: { url: d.url || "./" }
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type:"window", includeUncontrolled:true });
    for (const c of all){
      if ("focus" in c){ await c.focus(); if (c.navigate) await c.navigate(url); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
