/* Poseidon Dispatch — his own calendar, so he can see what's on before he
 * books a job into it.
 *
 * Read-only, and one direction only. This function never writes to Google and
 * never writes to the shop. Personal events are fetched for display and thrown
 * away; nothing personal is stored in `shops.data`, so a personal event he
 * deletes in Google disappears from Poseidon too, and the business row stays
 * business only.
 *
 * DEPLOY WITH JWT VERIFICATION ON. That is the default, so:
 *
 *   supabase functions deploy personal-calendar
 *
 * NOT --no-verify-jwt. The nightly-reminder function uses that flag because
 * the worst anyone with its URL can do is buzz his own phone. This one answers
 * with the titles of his family's appointments. With the flag, the URL alone
 * would read them out to anyone who had it. With verification on, Supabase
 * rejects the request before this code runs unless the caller presents a real
 * signed-in token for this project — which is what the app sends.
 *
 * Secrets:
 *   supabase secrets set \
 *     GOOGLE_CLIENT_ID=...apps.googleusercontent.com \
 *     GOOGLE_CLIENT_SECRET=... \
 *     GOOGLE_REFRESH_TOKEN=...
 *
 * The refresh token must be minted against the scope
 * https://www.googleapis.com/auth/calendar.readonly — never a write scope.
 * Google cannot be asked to write by this code, but a read-only token means a
 * leak cannot be used to change or delete anything either.
 *
 * See FOR-DARYL-calendar.md in the repo root for how to get those three values.
 */

const CLIENT_ID     = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const REFRESH_TOKEN = Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "";

/* His day, not UTC. A dentist appointment on the 3rd is the 3rd in Edmonton. */
const ZONE = Deno.env.get("SHOP_TZ") ?? "America/Edmonton";

/* The calendar poseidon-sync.py writes his own jobs into. If Poseidon read it
 * back, every job would appear twice and clash with itself. Excluded by name,
 * and every event is checked for the sync's own tag as a second guard. */
const EXCLUDE = (Deno.env.get("CAL_EXCLUDE") ?? "Work")
  .split(",").map((s: string) => s.trim().toLowerCase()).filter(Boolean);

type Ev = {
  id: string; cal: string; calName: string; title: string;
  date: string; endDate: string;
  start: string | null; end: string | null; allDay: boolean;
};

/* The date in his zone, as YYYY-MM-DD — the same shape the app stores dates
 * in. en-CA gives that format. Doing it this way means no offset arithmetic
 * anywhere: one helper script in the Helm repo hard-codes -07:00 and is an
 * hour wrong all summer. Intl knows when the clocks changed; we don't. */
const ymd = (iso: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date(iso));

const hhmm = (iso: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE, hour: "2-digit", minute: "2-digit", hour12: false
}).format(new Date(iso));

/* Each day of a multi-day event, so a Thursday inside a holiday still shows
 * as taken. Google gives all-day ends as exclusive, hence the < . */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T12:00:00Z");
  const stop = new Date(to + "T12:00:00Z");
  while (d <= stop && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function googleToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN, grant_type: "refresh_token"
    })
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    /* invalid_grant means he revoked access, changed his Google password, or
       the token went unused for six months. It needs re-doing by hand, and
       saying which it is saves him guessing. */
    const why = body?.error === "invalid_grant"
      ? "Google has stopped accepting the saved permission. It needs granting again."
      : (body?.error_description || body?.error || `HTTP ${res.status}`);
    throw Object.assign(new Error(why), { reauth: body?.error === "invalid_grant" });
  }
  return body.access_token as string;
}

async function gcal(path: string, token: string, params: Record<string, string>) {
  const url = new URL("https://www.googleapis.com/calendar/v3/" + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

Deno.serve(async (req: Request) => {
  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: cors });

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    return reply(200, { ok: false, setup: true,
      error: "Google isn't connected yet. The three GOOGLE_ secrets aren't set on this function." });
  }

  try {
    const u = new URL(req.url);
    const from = u.searchParams.get("from") || "";
    const to   = u.searchParams.get("to")   || from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
      return reply(400, { ok: false, error: "from and to must be YYYY-MM-DD" });

    /* A day either side, in UTC, then filtered by the Edmonton date above.
       Asking Google for the exact local window would mean working out the
       offset for that date, which is the one thing worth not doing by hand. */
    const timeMin = new Date(from + "T00:00:00Z"); timeMin.setUTCDate(timeMin.getUTCDate() - 1);
    const timeMax = new Date(to   + "T00:00:00Z"); timeMax.setUTCDate(timeMax.getUTCDate() + 2);

    const token = await googleToken();
    const list = await gcal("users/me/calendarList", token,
      { minAccessRole: "reader", maxResults: "250" });

    const calendars = (list.items || []).map((c: any) => ({
      id: c.id as string,
      name: (c.summaryOverride || c.summary || c.id) as string,
      excluded: EXCLUDE.includes(String(c.summaryOverride || c.summary || "").toLowerCase())
    }));

    const events: Ev[] = [];
    for (const cal of calendars) {
      if (cal.excluded) continue;
      const page = await gcal(`calendars/${encodeURIComponent(cal.id)}/events`, token, {
        singleEvents: "true", orderBy: "startTime", maxResults: "250",
        timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), timeZone: ZONE
      });
      for (const e of (page.items || [])) {
        if (e.status === "cancelled") continue;
        // The sync's own job events, if one ever lands outside the Work calendar.
        if (e.extendedProperties?.private?.poseidon_job_id) continue;
        // An invitation he turned down is not a commitment.
        const me = (e.attendees || []).find((a: any) => a.self);
        if (me?.responseStatus === "declined") continue;

        const allDay = !!e.start?.date;
        const title = String(e.summary || "(no title)");
        if (allDay) {
          const s = e.start.date as string;
          // Google's all-day end is the morning after; step back to the last day on.
          const endEx = new Date((e.end?.date || s) + "T12:00:00Z");
          endEx.setUTCDate(endEx.getUTCDate() - 1);
          const last = endEx.toISOString().slice(0, 10);
          for (const d of daysBetween(s, last < s ? s : last))
            events.push({ id: e.id, cal: cal.id, calName: cal.name, title,
              date: d, endDate: d, start: null, end: null, allDay: true });
        } else {
          const s = e.start.dateTime as string, en = (e.end?.dateTime || s) as string;
          const sd = ymd(s), ed = ymd(en);
          for (const d of daysBetween(sd, ed < sd ? sd : ed))
            events.push({ id: e.id, cal: cal.id, calName: cal.name, title,
              date: d, endDate: ed, start: hhmm(s), end: hhmm(en), allDay: false });
        }
      }
    }

    // Only the window he asked for; the padding was to catch the edges.
    const want = events.filter(e => e.date >= from && e.date <= to);
    return reply(200, { ok: true, zone: ZONE, from, to, calendars, events: want });

  } catch (err) {
    /* Never an empty success. A day with no events and a day we could not read
       look identical to a person, and he would book over his daughter's
       recital. The app shows this message instead of an empty calendar. */
    const e = err as any;
    return reply(200, { ok: false, reauth: !!e.reauth, error: String(e.message || e) });
  }
});
