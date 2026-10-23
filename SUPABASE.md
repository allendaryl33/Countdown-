# Getting your shop off the phone

Right now everything you type into the app lives in one browser on one device.
Lose the phone, lose the shop. This connects it to a free Supabase project so
every device you sign in on keeps the same shop, backed up automatically.

It's about ten minutes, once. You will never have to do it again.

Two things worth knowing before you start:

- **It is free at your size.** A one-person shop's data is around 50 KB. The
  free tier is 500 MB. You would need ten thousand years of jobs to outgrow it.
- **Nothing in the app's code knows your keys.** You type them into the app on
  your own devices. They are not in the repo and not in the published link, so
  nobody who has that link can reach your customers.

---

## Step 1 — make the project

1. Go to **supabase.com** and sign up. Use your business email.
2. Click **New project**.
3. Fill in:
   - **Name:** `poseidon`
   - **Database Password:** click Generate, then **save it in your password
     manager**. You will almost certainly never need it, but if you do need it
     and don't have it, there is no way to get it back.
   - **Region:** pick the closest one to Edmonton — Central Canada or US West.
4. Click **Create new project** and give it a couple of minutes to finish.

## Step 2 — make the tables

1. In the left sidebar, click **SQL Editor**.
2. Click **New query**.
3. Open `supabase-setup.sql` from this repo, copy the whole thing, paste it in.
4. Click **Run**.

You should see "Success. No rows returned." That's right — it made the tables,
it didn't put anything in them.

This creates two things: `shops`, which holds your live shop, and
`shop_backups`, which keeps the last 30 versions automatically. If you ever
wreck something, the previous versions are sitting right there.

## Step 3 — make your login

1. Left sidebar → **Authentication** → **Users**.
2. Click **Add user** → **Create new user**.
3. Put in your email and a password you'll remember. **Tick "Auto Confirm
   User"** — otherwise it'll wait for you to click a confirmation email.
4. Click **Create user**.

This is the login you'll use in the app, on every device. It is separate from
your Supabase account login.

## Step 4 — get the two values the app needs

1. Left sidebar → **Project Settings** (the gear) → **Data API**.
2. Copy the **Project URL**. It looks like `https://abcdefgh.supabase.co`.
3. Find the **publishable** key (newer projects call it `sb_publishable_…`;
   older ones call it the **anon** key and it starts `eyJ…`). Copy it.

> **Do not copy the secret key** — the one called `secret` or `service_role`.
> That one bypasses every security rule in Step 2. It belongs on a server, never
> in a browser. The app will refuse it if you paste it in by mistake, but know
> the difference anyway.

## Step 5 — connect the app

1. Open the app → **More** → **Data & Setup**.
2. Find the **Sync across your devices** card.
3. Paste in the Project URL and the publishable key. Tap **Save connection**.
4. Sign in with the email and password from Step 3.

That's it. The shop that was on that device goes up immediately, and the
indicator at the bottom of the sidebar turns green and says **Synced**.

## Step 6 — add your other devices

On the laptop, the second phone, anywhere: open the app, same card, same URL
and key, sign in with the same email and password. It pulls the shop down
instead of pushing one up.

---

## How it behaves day to day

**You don't do anything.** Changes go up a couple of seconds after you stop
typing. The app catches up whenever you switch back to it.

**No signal is fine.** Everything keeps working in a basement or out past
Spruce Grove. The indicator says "no connection — saved on this device", and
the moment you have a bar again it goes up by itself. Nothing is lost.

**If two devices change the same shop** — say you edited on the laptop while
the phone was offline — the app stops and asks. It never picks for you and it
never silently overwrites. Whichever copy you don't keep is downloaded to your
device first, so it's always recoverable.

**The old JSON export still works** and is still worth doing occasionally.
Belt and braces.

---

## Things that might go wrong

**"Invalid API key"** — the URL and key don't belong to the same project, or
there's a stray space on the end. Re-copy both.

**"Email or password not accepted"** — either the password is wrong, or you
forgot to tick "Auto Confirm User" in Step 3. Go back to Authentication →
Users and check whether the user shows as confirmed.

**"Couldn't reach the project"** — usually just no connection. If you're
definitely online, check the URL starts with `https://` and ends `.supabase.co`.

**Supabase pauses free projects that go unused for a while.** If it's been
quiet for weeks, log in to supabase.com and un-pause it. Your data is still
there; the project is just asleep.

---

## What this does not do

It syncs your shop. It is not an accounting system, it doesn't move money, and
it doesn't make the app multi-user — everybody who signs in with that one login
shares one shop. The day you hire somebody, this needs revisiting.
