# Working in this repo

This is the field-service dispatch app for **Poseidon Plumbing & Gasfitting
Ltd.**, Edmonton. It is used every day, by one person, to run a real business
with real customers and real money. It is not a demo.

Daryl is a working plumber, not a programmer. He reads what you write and acts
on it. Being wrong costs him time and sometimes money, and a mistake can reach
a customer — a bad work type once went out in a text to a woman about a job she
hadn't booked.

Read this whole file before your first change.

---

## The one rule the rest serve

**Never state something as true that you have not checked.**

Almost every bad hour on this project came from a confident claim that turned
out to be false: a default that asserted a specific wrong answer, a "deployed"
that wasn't, a green test run that had already been invalidated, a contractor's
"done" that wasn't done. When you don't know, say so. When you can check, check.

---

## Before you ship anything

1. **Run the whole suite, serially.** `./tests/run.sh`
2. **Do not edit source while it runs.** It reads files off disk; a change
   mid-run makes the result meaningless, green included. This has been done
   twice and both runs had to be thrown away.
3. **A merge is not a deploy.** After merging, fetch the live page and grep for
   the thing you just added before telling him it's live.
4. **A failing test is information.** Decide whether the test or the code is
   wrong — both happen. Updating a stale expectation is right; weakening an
   assertion to get green is not.
5. **Never report a green run you can't vouch for.** If anything disturbed it,
   throw it out, rerun, and say that you did.

---

## What it is

One file: `index.html`, about 10,000 lines. **No framework, no build step, no
dependencies, no bundler.** That is deliberate and it is why it has never once
broken because a package changed. Keep it that way.

- **State** lives in `Store.data`, persisted to `localStorage` under
  `pcp.dispatch.v1`, and synced to Supabase as **one JSON row** in `shops`.
- **`Store.backfill()`** migrates older saved shops. Anything added to the data
  shape goes there too, and must never overwrite what he has edited.
- **Concurrency** is a `rev` guard: a device says which revision it is
  replacing, so two devices colliding asks a question instead of losing work.
- **`renderQuiet()` / `viewHasLiveInput()`** stop a view being rebuilt while
  he's typing in it. Note `viewHasLiveInput` only checks inside `#view` —
  **modals in `#modal-root` are not covered**, so a modal that rebuilds itself
  must read its own fields back first.

### The other pages

- `sign.html` — the customer signs an estimate. Served from **his own domain**
  (`poseidonplumbing.ca/sign`), not here. It is a Cloudflare Workers static-assets
  site built from `allendaryl33/poseidon-website`, whose `build.sh` curls this
  repo's `sign.html` and `invoice.html` from `main` on every build. So a change
  here reaches customers only when that site is rebuilt — pushing to this repo
  alone does not deploy it. Before that was set up, both pages sat untracked in
  the site's `dist/` and a rebuild could have dropped them.
- `invoice.html` — the customer views an invoice and can save a PDF.
- Both get everything from the URL **hash** (`#…`), which browsers never send
  to a server, so tokens and keys stay out of access logs and referrers.

### Supabase

- `shops` (the whole shop as one row), `shop_backups`, `estimate_links`,
  `invoice_links`, `inquiries`, `push_subs`.
- **`anon` has no table rights.** The only anon-reachable surface is a handful
  of `security definer` RPCs with narrow signatures.
- **Grants are not automatic in this project.** New tables need explicit grants,
  and the role matters: the signed-in app is `authenticated`, not `anon`. Both
  the push functions and the `shops` read failed in production for exactly this.
- The `.sql` files in the root are run by hand in the Supabase SQL editor, in
  order. `supabase-reminders-cron.sql` goes **last**, after its Edge Function
  exists.

### Hosting

- **GitHub Pages, from `main`.** The repo is public *because Pages will not
  serve a private repo on a free plan.* Nothing sensitive is in here, and that
  is the actual safeguard — not the visibility flag.
- **Never change repository visibility or Pages settings.** Someone did; the
  whole live app 404'd until it was put back.
- `sw.js` is a service worker that is **network-first on purpose**. The
  installed app opens `start_url: "./"` with no cache-buster, so cache-first
  would silently serve last week's build. Supabase traffic bypasses the cache
  entirely — an offline copy of the shop would show yesterday's jobs as today's.

---

## Things learned the hard way. Do not undo these.

**Never let a fallback state a confident wrong answer.** `leadJobType` used to
fall back to `JOB_TYPES[0]`, which was "Drain Cleaning" — so an unmatched
inquiry became a drain job with total confidence, and a customer got a text
about drain cleaning for her shower rebuild. Unknown reads as **"Other"**.
"Other" never reaches a customer as the word "other"; their own wording stands
in. `workPhrase()` / `workLabel()` exist for this.

**Honest failure beats quiet wrongness.** Always. An error he can see beats a
plausible lie.

**Don't record something you only hope happened.** Handing a text to the phone
was logged as "sent", so backing out of Messages still marked the job done. iOS
never reports whether send was pressed — so the app **asks** ("Did it go?")
instead of assuming. `beginSend` / `finishSend` / `resumePendingSend`.

**Never silently rewrite his records.** Renaming a work type carries its jobs
and estimates because he asked and it says how many moved. Deleting one carries
nothing. Dropdowns always include the record's own current value so a stale
value can't be silently replaced on the next save.

**Anything already sent is frozen.** Signing and invoice payloads are captured
at publish time. A later edit must never change what somebody already agreed
to. Re-sending creates a *second* live link, it does not replace the first.

**Confirm before anything irreversible**, and look at what you're about to
overwrite first.

---

## Tests

`tests/` — about 50 suites, plus `mock-supabase.js` and screenshot tools.

    npm install --no-save playwright-core
    ./tests/run.sh

They drive a **real browser against the real page through the DOM**, the way he
would. They don't test internals. Names are sentences about what he gets
("backing out records nothing at all"), not function names.

- **Serial, always.** They share one mock backend and each resets it; two at
  once wipe each other and invent failures.
- **Assert against a snapshot, not a constant.** "The log is empty" breaks as
  soon as an earlier test legitimately writes to it.
- **Some paths can't be driven headlessly.** Following an `sms:` link makes
  headless Chromium stop delivering clicks to the page entirely — verified with
  a capture-phase spy. Where you hit that, test the halves separately and
  **write a comment saying why**.
- A console error or page error is a failure even if every assertion passed.

---

## Git

- Branch, never commit to `main` directly.
- **PRs are squash-merged**, so after a merge your branch's history diverges
  from `main` even though the content matches. The next change starts by
  rebuilding the branch on `origin/main`, or the following PR shows a phantom
  conflict.
- Commit messages say **why**. The diff already says what. There are 130+ of
  them and they are the record of this project's reasoning.
- Push only when the suite is green.

---

## Talking to him

- **Lead with what's wrong.** Then what works.
- **Give him clickable links and pasteable code.** He does not browse file
  trees or open files from a repo. If a step needs a file's contents, put the
  contents in the message. He has asked for this explicitly; getting it wrong
  wastes his time.
- **Say "I don't know" plainly**, and say what you did *not* do, every time.
- **Own a mistake in one sentence** and move on.
- **He pushes back when something smells wrong, and he is usually right.** He
  caught a message claiming "sent" when he'd backed out, a work type that
  didn't match what the customer picked, and an instruction that cost him a
  day's data. Check before defending.
- **Victor** is a contractor/agent who handles the website, DNS and Supabase
  deploys. He works fast and is useful, but he has got it wrong more than once
  — a stale API key, a repo visibility change that took the app down. **Verify
  his work rather than relaying it**, and he operates with Daryl's full GitHub
  rights, so permissions won't contain him.

---

## Settled since, so don't re-raise it

- The reminder function's open endpoint is closed. `nightly-reminder` now
  checks an `x-reminder-secret` header against the `REMINDER_SECRET` function
  secret and returns 401 otherwise, skipping the check only when the secret is
  unset. Its source is tracked at
  `poseidon-website/supabase/functions/nightly-reminder/index.ts`.
  `supabase-reminders-cron.sql` sends that header — with a **placeholder**, as
  it does for the service key, because this repo is public.

## Open, as of the last session

- **The waiver templates have never been reviewed by a lawyer or an insurer**,
  and they are attached to live jobs. Flagged repeatedly. Still open.
- Stripe: bank account → Stripe account → webhook. The one-tap receipt prompt
  is designed but parked until that lands.
- **`stripe-paid`'s source is in neither repo.** Victor reports it is at
  `poseidon-website/supabase/functions/stripe-paid/index.ts` with a full
  `verifyStripeSignature()` over `crypto.subtle` — 300s timestamp tolerance,
  HMAC-SHA256, constant-time compare, run before anything else. That is not in
  git on `main` and `git log --all` finds no trace of it, so it was presumably
  read out of the Supabase dashboard. Nobody can review or reproducibly
  redeploy it as things stand. Before real cards: get it committed, and set the
  Stripe webhook endpoint plus `STRIPE_WEBHOOK_SECRET`.
