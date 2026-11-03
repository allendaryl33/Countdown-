/* Poseidon Dispatch — the night-before buzz.
 *
 * Runs once an evening. Reads the shop, counts tomorrow's jobs that have not
 * been confirmed with the customer yet, and if there are any, pushes a
 * notification to his phone.
 *
 * It sends nothing to customers, ever. The only recipient is him, and the
 * text to the customer still leaves from his own phone, from his own number.
 * This is a reminder to do a thing, not the thing.
 *
 * Deploy:
 *   supabase functions deploy nightly-reminder --no-verify-jwt
 *   supabase secrets set VAPID_PUBLIC=... VAPID_PRIVATE=... VAPID_SUBJECT=mailto:...
 *
 * The schedule lives in supabase-reminders-cron.sql.
 */

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC  = Deno.env.get("VAPID_PUBLIC")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE")!;
// Required, like the keys. A default here would either bake an address into
// a public repo or stand in a placeholder that push services reject at send
// time — failing on the first line is better than failing in the evening.
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT")!;

/* His day, not UTC. A job on the 3rd is the 3rd in Edmonton. */
const ZONE = Deno.env.get("SHOP_TZ") ?? "America/Edmonton";

function ymdIn(zone: string, plusDays = 0): string {
  const now = new Date(Date.now() + plusDays * 86400000);
  // en-CA gives YYYY-MM-DD, which is the format the app stores
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
}

async function db(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

Deno.serve(async () => {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    const subs = await db("push_subs?select=endpoint,p256dh,auth,shop");
    if (!subs.length) return Response.json({ sent: 0, why: "nobody subscribed" });

    const shops = await db("shops?select=data&limit=1");
    const data = shops[0]?.data;
    if (!data) return Response.json({ sent: 0, why: "no shop yet" });

    const target = ymdIn(ZONE, 1);
    const jobs: any[] = Array.isArray(data.jobs) ? data.jobs : [];
    const customers: any[] = Array.isArray(data.customers) ? data.customers : [];
    const hasPhone = (j: any) => {
      const c = customers.find(c => c.id === j.customerId);
      return !!(c && c.phone);
    };

    // The same rule the app's own strip uses: booked for tomorrow, not
    // cancelled, reachable, and not already confirmed FOR THAT DATE — a job
    // moved to another day counts as unconfirmed again.
    const due = jobs.filter(j =>
      j.scheduledDate === target &&
      j.status !== "cancelled" &&
      (j.reminded?.forDate !== target) &&
      hasPhone(j));

    if (!due.length) return Response.json({ sent: 0, why: "nothing unconfirmed", target });

    const body = due.length === 1
      ? "1 job tomorrow isn't confirmed yet. Tap to send it."
      : `${due.length} jobs tomorrow aren't confirmed yet. Tap to send them.`;

    const payload = JSON.stringify({
      title: "Confirm tomorrow's work", body, tag: "reminder-" + target, url: "./"
    });

    let sent = 0;
    const dead: string[] = [];
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
        sent++;
      } catch (err: any) {
        // 404/410 mean the phone threw the subscription away — most likely
        // the app was deleted and re-added. Stop pushing to a dead endpoint.
        if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.endpoint);
        else console.error("push failed", err?.statusCode, err?.body ?? err?.message);
      }
    }

    if (dead.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/push_subs?endpoint=in.(${
        dead.map(e => `"${encodeURIComponent(e)}"`).join(",")})`, {
        method: "DELETE",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      }).catch(() => {});
    }

    return Response.json({ sent, jobs: due.length, pruned: dead.length, target });
  } catch (err) {
    console.error(err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
