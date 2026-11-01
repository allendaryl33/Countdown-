# For Victor — the night-before reminder

Daryl gets a push notification in the evening when the next day has jobs he
hasn't confirmed with the customer yet. He taps it, the app opens on the list,
he taps Confirm beside each one and the text goes from his own phone, from his
own number, like it always has.

**Nothing in this sends anything to a customer.** The only recipient of
anything automatic is Daryl. No Twilio, no new number, no A2P registration.

There are three pieces. Two are his, one is yours.

---

## What's already done

- `sw.js` — the service worker. Receives the push and shows the notification.
  It's served from the repo root, no action needed.
- The app asks for permission and hands the subscription to Supabase.
- `supabase-reminders.sql` — the `push_subs` table and the two functions the
  app calls. **Daryl runs this himself** in the SQL editor, like the others.

## What's yours — the Edge Function

The function is written and in the repo at
`supabase/functions/nightly-reminder/index.ts`. It needs deploying, which is
the one part that can't be done from the SQL editor.

```bash
supabase link --project-ref <PROJECT-REF>
supabase functions deploy nightly-reminder --no-verify-jwt
```

Then the three secrets. **The keypair already exists — Daryl will send you
the two values.** Please use exactly those and don't generate a new pair: the
public half is baked into the app, and a fresh pair stops every subscription
his phone has already made from decrypting.

```bash
supabase secrets set \
  VAPID_PUBLIC=<the public value Daryl sends> \
  VAPID_PRIVATE=<the private value Daryl sends> \
  VAPID_SUBJECT=mailto:allendaryl@hotmail.com
```

The public half is also visible in `index.html` as `VAPID_PUBLIC` if you want
to check the two match — that one is public by design. The private half is
not in this repo and must not be put in it.

`VAPID_PRIVATE` is a secret. It belongs in `supabase secrets` and nowhere
else — not in the repo, not in a link, not in the app.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform;
you don't set those.

### Check it

```bash
curl -X POST https://<PROJECT-REF>.supabase.co/functions/v1/nightly-reminder \
  -H "Authorization: Bearer <SERVICE-KEY>"
```

Expected shapes:

- `{"sent":0,"why":"nobody subscribed"}` — Daryl hasn't turned it on yet
- `{"sent":0,"why":"nothing unconfirmed","target":"2026-11-02"}` — working,
  just nothing to say
- `{"sent":1,"jobs":2,"pruned":0,"target":"2026-11-02"}` — it buzzed his phone

## Last — the schedule

Once the function answers, Daryl runs `supabase-reminders-cron.sql`, which
calls it at 7:30pm Edmonton. **That file has to go last**, after the function
exists, or the cron will fire at nothing.

---

## Things worth knowing

**The timezone is doubled on purpose.** `pg_cron` runs on UTC and Edmonton
shifts an hour twice a year, so the cron file schedules two jobs and each one
checks the local clock before calling out. Only the one in the 7pm hour
locally actually fires. Without that the buzz drifts an hour every spring.

**Dead subscriptions clean themselves up.** If the push service answers 404 or
410 the endpoint is deleted. That happens when the app is removed from the
home screen — iOS throws the subscription away with it.

**The function reads `shops.data` directly.** It applies the same rule as the
app's own screen: scheduled for tomorrow, not cancelled, customer has a phone,
and `reminded.forDate` is not already that date. If the two ever disagree the
app's version is the one to match.

**The service worker is network-first, deliberately.** The installed app opens
`start_url: "./"` with no cache-buster, which is why Daryl has been deleting
and re-adding it to get new versions. Network-first means it just picks up
whatever Pages is serving. Please don't switch it to cache-first for speed —
it would serve him stale builds silently, and it would cost him the push
subscription every time he worked around it by reinstalling.
