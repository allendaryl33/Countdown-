-- ============================================================
--  Estimate options — closing the others off, in the database
--  Poseidon Plumbing & Gasfitting Ltd.
--
--  Run this in the Supabase SQL editor AFTER supabase-signing.sql.
--  It is safe to run twice.
--
--  WHAT IT IS FOR
--
--  An estimate can now go out with two or three ways of doing the same job:
--  patch the valve for $600, or rebuild the shower for $8,400. Each one is
--  its own signing link, because what somebody signs has to be one specific
--  scope at one specific price, frozen — the same rule the rest of this
--  project runs on.
--
--  The customer's page tells her, in writing, that approving one closes the
--  others off. Today the page is the only thing that keeps that promise: it
--  re-checks the other links the moment before it submits. That is a good
--  guard and it holds in every ordinary case, but it is not an absolute
--  one — two phones, two links, two taps inside the same second, and both
--  rows could end up signed. She would then have put her name to two
--  prices for one job, and the page would have told her that could not
--  happen.
--
--  This makes it true rather than nearly true.
--
--  WHAT IT CHANGES
--
--  sign_estimate gains one condition: it refuses if any link for the same
--  estimate has already been signed. Nothing else about it moves.
--
--  * Same name, same four arguments, same return shape. The signature is
--    what grants are attached to in Postgres, so the existing grants carry
--    and there is nothing new to grant. (Grants are not automatic in this
--    project — both the push functions and the shops read failed in
--    production for exactly that. This avoids the question entirely.)
--  * No new column, so nothing the app inserts has to change. The app keeps
--    working whether or not this has been run — it is strictly a tightening.
--  * It also fixes something that was already loose: re-sending an estimate
--    deliberately creates a second live link rather than replacing the
--    first, and until now both of those could be signed.
--
--  The one behaviour to be aware of: once any link for an estimate is
--  signed, every other link for that estimate stops being signable. That is
--  the intended rule. If the price genuinely needs to change after a
--  signature, that is a new estimate, not a second signature on the old one.
-- ============================================================

create or replace function public.sign_estimate(
  p_token text, p_name text, p_role text, p_signature text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n int;
  v_estimate text;
  v_taken int;
begin
  if coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name required');
  end if;
  -- A real signature is a png data url of some size. This is not security,
  -- it just stops an empty box being recorded as agreement.
  if coalesce(p_signature, '') !~ '^data:image/png;base64,' or length(p_signature) < 200 then
    return jsonb_build_object('ok', false, 'reason', 'signature required');
  end if;
  if length(p_signature) > 400000 then
    return jsonb_build_object('ok', false, 'reason', 'signature too large');
  end if;

  -- Which estimate this link belongs to. Looked up rather than trusted from
  -- the caller: the only thing the customer's page holds is a token.
  select estimate_id into v_estimate
    from public.estimate_links
   where token = p_token;

  if v_estimate is null then
    return jsonb_build_object('ok', false, 'reason', 'already signed, or the link has expired');
  end if;

  -- Has one of this estimate's links already been signed? If so this is a
  -- second signature on the same piece of work, whether it arrived as
  -- another option or as a link that was re-sent, and it does not happen.
  select count(*) into v_taken
    from public.estimate_links
   where estimate_id = v_estimate
     and token <> p_token
     and signed_at is not null;

  if v_taken > 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'this estimate has already been approved');
  end if;

  update public.estimate_links
     set signer_name = trim(p_name),
         signer_role = nullif(trim(coalesce(p_role, '')), ''),
         signature   = p_signature,
         signed_at   = now()
   where token = p_token
     and expires_at > now()
     and signed_at is null;

  get diagnostics n = row_count;
  if n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'already signed, or the link has expired');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Same signature, so the grants from supabase-signing.sql still apply.
-- Re-stated anyway, because assuming a grant is there is how two things in
-- this project broke in production.
grant execute on function public.sign_estimate(text, text, text, text) to anon, authenticated;

-- Reading a link is unchanged. Looking up the other options is the customer
-- page calling estimate_for_signing once per token, which it is already
-- allowed to do.

-- Two links for one estimate, one of them signed. The second must come back
-- with ok:false. Swap in a real token pair to check it by hand:
--
--   select public.sign_estimate('<the unsigned token>', 'Test Name', 'Homeowner',
--     'data:image/png;base64,' || repeat('A', 300));
--
-- Expect: {"ok": false, "reason": "this estimate has already been approved"}
