# Two more for the website, and one automation

The first is five minutes. The second is the interesting one.

---

## 1. Host the invoice page

Same as `sign.html`: host **`invoice.html`** (repo root) at
**`https://poseidonplumbing.ca/invoice`**, beside the signing page. Standalone,
no dependencies.

Fill in the same two constants at the top of the `<script>` so links stay short:

```js
const BAKED_URL = "https://oddfdrbyvgibklqdadrv.supabase.co";
const BAKED_KEY = "<the publishable key>";
```

Allen runs `supabase-invoice-links.sql` on his side. Nothing else needed.

---

## 2. Tell the app when Stripe gets paid

Right now Allen taps **Money received** by hand. Stripe knows, the app doesn't,
and nothing connects them. This connects them.

### How the invoice is identified

The app already appends the invoice's token to the Stripe payment link:

```
https://buy.stripe.com/xxxx?client_reference_id=8911e972dd6f98fac240aee76c73638b
```

Stripe hands that straight back as `client_reference_id` on the webhook event.
That token is the primary key of `public.invoice_links`. No lookup by amount,
no guessing, no Stripe API call needed.

### What the function does

One Edge Function, `stripe-paid`, on the **webhook endpoint** Stripe posts to.
It writes three columns on that row and nothing else:

```sql
update public.invoice_links
   set paid_at = now(), paid_amount = <amount>, paid_ref = <payment intent id>
 where token = <client_reference_id>;
```

The columns already exist. The app reads them on its next sync and marks the
job paid, by card, with the Stripe reference on it. **The function must not
touch `shops`** — that row is the app's and is guarded by a revision number.

### Three things that matter

1. **Verify the Stripe signature.** `stripe-signature` header against the
   webhook signing secret, using `stripe.webhooks.constructEvent` (or
   `constructEventAsync` on Deno). Without this, anyone who finds the URL can
   POST "paid" and Allen will think he's been paid when he hasn't. This is the
   one thing in here that must not be skipped.
2. **Use the service role key** for the update — `anon` has no rights on that
   table, deliberately.
3. **Be idempotent.** Stripe retries. `where token = ... and paid_at is null`
   if you want it strict; re-running the same update is harmless either way.

### Events

`checkout.session.completed` is the one that carries `client_reference_id`.
Take `amount_total / 100` and `payment_intent` from it.

If a payment link is set to anything other than a one-off checkout, check the
event you actually receive still carries `client_reference_id` before relying
on it.

### Deploy with

```
supabase functions deploy stripe-paid --no-verify-jwt
```

`--no-verify-jwt` because Stripe can't present a Supabase JWT. The Stripe
signature check is what secures it, which is why point 1 isn't optional.

Then in the Stripe dashboard: Developers → Webhooks → add the function's URL,
select `checkout.session.completed`, and put the signing secret in the
function's environment as `STRIPE_WEBHOOK_SECRET`.

### How to know it worked

Stripe's dashboard has a "Send test webhook". After one, the matching row in
`invoice_links` should have `paid_at` set. Allen's app will say *"An invoice
just got paid"* within a minute.

---

## Nothing here can break what's running

The invoice page is a new file at a new address. The three payment columns were
added with `add column if not exists`. The function is new and writes to one
table that only it and Allen's app can reach. The form, the leads, and the
signing page are untouched.
