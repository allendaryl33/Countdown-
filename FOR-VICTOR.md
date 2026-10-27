# Two things for the website

Both are small and neither touches anything that's already working. The
dispatch app reads from the same Supabase project (`oddfdrbyvgibklqdadrv`), so
there's nothing new to connect — only two things to add on the website side.

---

## 1. Photos on the inquiry form

**Why this one matters more than it looks.** People describe plumbing wrong,
reliably. "A leaky tap" is a cracked stack about half the time. A photo
decides whether a job needs an hour of unpaid driving to quote, or can be
quoted from the truck. Allen reckons it kills most of his estimate visits.

### What's already done

Run on the database (nothing needed from you):

- A private bucket **`inquiry-photos`**, max **8 MB** a file, images only
  (`jpeg`, `png`, `webp`, `heic`).
- `anon` can **insert and nothing else** — no read, no list, no overwrite, no
  delete. Someone who lifts the key out of the page source can post a photo
  that only Allen will ever see. That's the worst case.
- A **`photos jsonb not null default '[]'`** column on `public.inquiries`.
  Added with `add column if not exists`, so the existing form keeps working
  untouched whether or not it ever writes to it.

### What the form needs to do

1. A file input, `multiple`, `accept="image/*"`. On a phone that gives camera
   and library in one tap with no extra work.
2. For each file, upload to the bucket before (or alongside) the insert:

   ```js
   const path = `${crypto.randomUUID()}/${i}-${file.name.replace(/[^\w.\-]/g, '_')}`;
   await supabase.storage.from('inquiry-photos').upload(path, file, {
     contentType: file.type, upsert: false
   });
   ```

   A UUID folder per submission keeps paths unguessable and collision-free.

3. Write the paths into the inquiry row, same shape as above:

   ```js
   photos: ['<uuid>/0-drain.jpg', '<uuid>/1-under_sink.jpg']
   ```

   A plain array of strings. The app also accepts `[{path: "..."}]` if that's
   easier, and treats a missing or empty `photos` as "no photos" — so a
   partial rollout breaks nothing.

### Worth doing on your side

- **Resize before upload.** A modern phone photo is 3–6 MB and most of that is
  resolution nobody needs. Longest edge 1600px at ~0.7 JPEG quality lands
  around 200–400 KB and looks identical on screen. It also means the upload
  finishes on a bad connection in somebody's basement.
- **Cap it at 4 files.** More than that is rarely more information.
- **Don't block the submit on the upload.** If a photo fails, send the inquiry
  anyway — a lead with no photo beats no lead.
- **Say what it's for.** "Add a photo or two — it helps us quote without a
  visit" gets far more uploads than "Attachments".

### What Allen sees

Thumbnails on the lead the moment it arrives, tap for full size, and they
carry onto the job or estimate when he books it. Already built and tested.

---

## 2. Host the signing page on `poseidonplumbing.ca`

When Allen sends an estimate for signature, the customer gets a link. Right
now it reads `allendaryl33.github.io/Countdown-/sign.html#...`, which is the
one thing in the whole system that looks like a side project.

### What's needed

Host the single file **`sign.html`** (in the repo root) at
**`https://poseidonplumbing.ca/sign`**. It's completely standalone — no
dependencies, no fonts, no build step, no framework. One file, serve it.

Nothing else changes: the page gets everything it needs from the part of the
link after the `#`, which is also why no keys live in that file or in the
repo.

Tell Allen the address when it's up; he pastes it into **Data & Setup →
Signing page address** and every link from then on uses it. Links already sent
keep working at the old address.

### One more line, to make the links short

As shipped, every link has to carry the project URL and the publishable key,
because a generic copy of the page can't know whose project it belongs to.
That makes a link around 210 characters. On your copy it doesn't have to.

At the top of the `<script>` in `sign.html`:

```js
const BAKED_URL = "";
const BAKED_KEY = "";
```

Fill those two in with the project URL and the **publishable** key (not the
secret one), and the links drop to about 70 characters — just the domain and
a code:

```
https://poseidonplumbing.ca/sign#t=a7f3c91e4b2d...
```

No new exposure: that key is already in the page source of the site that
submits to this project. This only stops it making a round trip through a
customer's text messages.

Tell Allen when it's done — there's a **Short links** tick-box next to the
address in Data & Setup, and it has to stay off until those two values are in,
or the links won't open.

The copies in the repo stay empty so the repo stays key-free.

### If it's easier to redirect

A redirect from `poseidonplumbing.ca/sign` works **only if the `#` fragment is
preserved** — most are, but a server-side 301 that rebuilds the URL will drop
it and the page will say the link is incomplete. Hosting the file directly is
safer.

---

## Nothing here can break what's running

The bucket is new. The `photos` column is additive with a default. The signing
page is a separate file at a separate address. The form keeps working exactly
as it does today at every step, including halfway through.
