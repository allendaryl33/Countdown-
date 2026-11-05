# Poseidon — estimate options: two deploys needed

Two items. The first is a blocker for a feature that is otherwise shipped; the
second is a correctness fix that can follow. There are also three questions at
the bottom.

---

## 1. `sign.html` → `poseidonplumbing.ca/sign` (blocker)

**What changed.** An estimate can now carry multiple options — e.g. patch the
mixing valve for $600, or strip and rebuild the shower for $8,400. Each option
is published as its **own row in `public.estimate_links` with its own token**,
because what a customer signs has to be one frozen scope at one frozen price.
Every row's `payload` additionally carries the whole set:

```json
{
  "option": "Patch the valve",
  "options": [
    { "token": "…32 hex…", "label": "Patch the valve",           "total": 600 },
    { "token": "…32 hex…", "label": "Rebuild the whole shower",  "total": 8400 }
  ]
}
```

`sign.html` reads `payload.options`. If it has more than one entry the page
renders a chooser first (label left, price right, "Sign and approve here →"),
calls `estimate_for_signing` once per sibling token to detect an
already-signed one, and only then renders the full estimate + signature pad for
whichever the customer taps. Submit posts the **displayed** token, not the
token the link arrived on.

**No schema or RPC change is required for this.** It is purely the static page.

**The source is `sign.html` at the root of `allendaryl33/Countdown-`,
branch `claude/park-city-plumbing-app-a39n90`** (merging to `main` shortly).
It is self-contained — no build, no deps — and `BAKED_URL` / `BAKED_KEY` are
already filled in for the live project, so deploy it as-is.

**The actual problem, and why I'm asking rather than doing it.** I checked the
live page:

```
$ curl -s https://poseidonplumbing.ca/sign | md5sum
76ba2a000508f83a69518c2442a8a6d6
$ md5sum sign.html        # Countdown- repo, main
76ba2a000508f83a69518c2442a8a6d6
```

Byte-identical — so the live copy came from this repo. But `/sign` appears
**nowhere in `allendaryl33/poseidon-website`**: not tracked in git, not in
`build.sh` (which copies only `index.html gallery.html logo.png`, the favicons
and `images/` into `dist/`), and not in the committed `dist/`. So the live
`/sign` is an unmanaged artifact — it survives because `build.sh` doesn't
`rm -rf dist`, or because it's served by a separate Pages project / Worker
route.

Two asks:

1. **Deploy the new `sign.html` to `/sign`** by whatever mechanism is currently
   serving it.
2. **Tell me what that mechanism is**, and preferably put it under version
   control so the next change deploys on push. If `/sign` is served out of
   `poseidon-website`, the minimal fix is something like:

   ```bash
   # in poseidon-website
   mkdir -p sign
   curl -sfo sign/index.html \
     https://raw.githubusercontent.com/allendaryl33/Countdown-/main/sign.html
   # build.sh
   mkdir -p dist/sign && cp sign/index.html dist/sign/index.html
   ```

   …but I don't want to guess at the topology and have you discover the real
   route is a Worker. Your call on the shape; the requirement is that
   `poseidonplumbing.ca/sign` tracks `Countdown-:sign.html` without a manual
   copy. Same question applies to `/invoice`, which is presumably in the same
   position.

---

## 2. `supabase-estimate-options.sql` (correctness, can follow)

Run in the Supabase SQL editor, after `supabase-signing.sql`. Idempotent.

Source: `supabase-estimate-options.sql` at the root of `Countdown-`
(raw: `https://raw.githubusercontent.com/allendaryl33/Countdown-/main/supabase-estimate-options.sql`)

**What it does.** `create or replace function public.sign_estimate(text, text,
text, text)` with one added guard before the `update`:

```sql
  select estimate_id into v_estimate
    from public.estimate_links
   where token = p_token;

  if v_estimate is null then
    return jsonb_build_object('ok', false, 'reason', 'already signed, or the link has expired');
  end if;

  select count(*) into v_taken
    from public.estimate_links
   where estimate_id = v_estimate
     and token <> p_token
     and signed_at is not null;

  if v_taken > 0 then
    return jsonb_build_object('ok', false,
      'reason', 'this estimate has already been approved');
  end if;
```

**Why it matters.** The customer page states in writing that approving one
option closes the others off. Right now the page is the only thing enforcing
that — it re-checks siblings immediately before submit. That covers every
ordinary case but it is not atomic: two devices, two links, two taps inside the
same second, and both rows get `signed_at`. The customer would then have signed
two prices for one job after being told that couldn't happen.

**Deliberately chosen properties:**

- **Signature unchanged** — `sign_estimate(text, text, text, text)`. Grants
  attach to the signature, so the existing
  `grant execute … to anon, authenticated` carries. (The file re-states it
  anyway. Grants in this project are not automatic and both the push functions
  and the `shops` read have failed in production for exactly that reason.)
- **No new column.** Nothing the app inserts changes, so the app works
  identically whether or not this has been run. It is strictly a tightening —
  there is no ordering dependency against the `sign.html` deploy.
- It also closes a pre-existing hole: re-sending an estimate intentionally
  creates a *second* live link rather than replacing the first, and until now
  both of those were independently signable.

**Behaviour to be aware of:** once any link for an estimate is signed, every
other link for that estimate becomes unsignable. That is the intent. A price
change after signature is a new estimate, not a second signature on the old one.

Verify after running:

```sql
-- against a known estimate that already has one signed link
select public.sign_estimate(
  '<an unsigned token for that same estimate>',
  'Test Name', 'Homeowner',
  'data:image/png;base64,' || repeat('A', 300));
-- expect: {"ok": false, "reason": "this estimate has already been approved"}
```

---

## 3. Questions

1. **`/sign` and `/invoice` hosting** — as above: what serves them, and can it
   be made to track the repo? This is the one I most need answered, because
   right now a redeploy of the website could silently drop either page and the
   first sign of it would be a customer with a dead estimate link.

2. **`stripe-paid` Edge Function** — the source is in neither
   `Countdown-` nor `poseidon-website`. Where does it live, and does it verify
   the `Stripe-Signature` header against the webhook signing secret before
   trusting the event body? Nothing is live on it yet, so this is a
   before-real-cards question, not an incident.

3. **`send-reminders` Edge Function** — deployed `--no-verify-jwt`, so anyone
   with the URL can trigger it. Impact today is limited to pushing a
   notification to Daryl's phone, so it is not urgent, but a shared-secret
   header checked in the function would close it next time that function is
   touched. Worth doing while you're in there?
