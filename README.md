# Poseidon Plumbing & Gasfitting Ltd. — Service Dispatch

A dispatch board for the office: take service calls, put jobs on the schedule,
assign technicians, and track each job from the phone call to a signed ticket.

## Going live

The app ships loaded with a sample shop so it demos well. **Data & Setup →
Set up for real jobs** clears it: the demo customers, jobs, estimates and signed
waivers go, your **price book and waiver templates stay** (edit those, don't
retype them), and you're set up as the first technician with your own rate. Job
numbering can start wherever you like, so it can continue from work you've
already invoiced by hand.

## Brand colours

Service area is Edmonton, Alberta — the sample customers, phone numbers and
the one-call reference in the excavation waiver are all local.

Deep-sea navy and marine blue carry the identity, with brass as the single
accent — Poseidon's trident is the mark. Those three are the brand.

**Red, green and amber are reserved for meaning**, never for branding: red is
an emergency, green is complete or paid, amber is something needing attention.
That separation is why a red badge always means the same thing wherever you see
it. All of it is defined as CSS variables at the top of `index.html`
(`--navy`, `--blue`, `--gold`, `--amber`, `--green`, `--red`) — change a value
there and it flows through the whole app.

**Open `index.html` in a browser.** That's the whole install. It is one
self-contained file — no server, no build step, no accounts, no internet
connection required.

## What it does

**Dashboard** — today at a glance: job counts, open emergencies, anything still
without a technician, and the day laid out tech by tech.

**Today** — the field view, and where the app opens. Your run for the day as a
list of stops: arrival window, customer, address, what's wrong, and the site
notes that matter before you knock. Tap to call, tap for directions, sign a
waiver, and move the job along with one button that says what actually happens
next — *On my way*, *I'm here*, *Mark done*. Anything still owed from earlier
in the week sits at the bottom. On a phone the sidebar becomes a bottom bar and
everything else lives behind **More**.

**Customer messages** — four short texts: *Booked*, *On my way*, *Running late*,
*Finished*. The app writes the message and hands it to your phone, so it sends
from **your own number** and a reply comes back to you. No texting service, no
monthly fee, nothing to break.

Travel time comes from a **zone** on the customer record — Edmonton, Greater
Edmonton, Out of area — so the message states one clean time instead of hedging.
Running behind? Tap **+15** or **+30** before you send and the wording follows
("about 30 minutes" becomes "about an hour"). Every message is editable before
it goes, and there's a Copy button for desktop or for pasting elsewhere.

Messages use a short trading name; waivers, estimates and tickets keep the full
legal name. Templates, zone names and travel times are all editable under
**Data & Setup → Customer messages**.

**Schedule** — three views of the same work, switched from the toolbar:

- **Day** — a column per technician plus an Unassigned column. Drag a job card
  onto a technician to assign it.
- **Week** — technicians down the side, the seven days across. Drag a job to
  another cell to change the day, the technician, or both at once.
- **Month** — a calendar coloured by technician, with a legend. Click any day to
  open it in Day view. Drag a job to another date to move it.

The arrows step by whatever you're looking at — a day, a week, or a month — and
**Today** always brings you back. Jobs with no date at all sit in a strip above
the board so they can be dragged onto a day and scheduled.

**Estimates** — quote work before it's agreed to. An estimate can go to someone
who isn't a customer yet, so quoting ten people doesn't leave ten names in your
customer list. Build the priced lines from your price book, mark it Sent, and
when the customer says yes, **Approve & convert** turns it into a scheduled job
in one step — adding them as a customer at that point (or linking them to one
already on file), copying the line items across, and recording the agreed price.
Print a customer-facing estimate with terms and a signature line. The list
tracks what's out for decision, what it's worth, and your win rate.

**Price Book** — the reusable list estimates are built from: labor rates, parts,
and flat-rate jobs. Pick an item and the line fills itself in. Type something
that isn't in the book yet and tick *also save this to the price book* to add it
as you go.

**Waivers** — a library of signed acknowledgments for the moments that generate
claims: drain and sewer line condition, hydro-jetting, camera inspection limits,
gas leaks and red tags, gas pressure testing, boiler service, water heater
replacement, customer-supplied materials, declined repairs, property access,
access openings, winterization and freeze, excavation and private utilities, and
suspected hazardous material. Open a job, pick a waiver, and the customer,
address and job number fill themselves in. The customer ticks each
acknowledgment and signs on screen — finger, stylus, or mouse. The signed copy
freezes its own wording, so editing a template later never changes what someone
already put their name to. Print or export any of them. **You can also build
your own** from scratch, with merge fields.

**Jobs** — every job, filterable by status, technician, type, and open/closed.
Each job carries the customer, address, reported problem, arrival window,
priority, parts used, labor hours, a running total, and a timestamped activity
log of every status change and note. A job created from an estimate carries the
quoted price and shows what it's running over or under once the tech adds
parts. Job types that normally want a waiver say so on the job record until one
is signed.

**Leads** — what came in off the website, in a list instead of a chat.

The website writes every inquiry into `public.inquiries`, in the **same**
Supabase project the shop syncs to. So there was no pipe to build: the app was
already signed in to the database the leads were sitting in. Setup is one more
SQL file, [supabase-leads.sql](supabase-leads.sql), which opens a window
between the two rooms.

Each lead shows who, their number, **what they said in their own words**, and
roughly when they're free. One tap turns it into a job or an estimate — the
customer record is created for you, matched on the last ten digits of the
phone so a second inquiry from the same person doesn't make a second customer.
Dealt-with leads move down the page and can be put back.

The job it creates is **unscheduled on purpose**. A lead says roughly when
they're free; you pick the actual slot. Nothing here books anything.

Two things it deliberately does not do. It **never writes** to the website's
table — that table belongs to the website, and a bug in dispatch must not be
able to break the thing taking the calls, so which lead has been dealt with is
kept in the shop instead. And it **never notifies you**: new leads show as a
strip on Today, and whatever already pings your phone keeps that job.

**Taking a lead down yourself** — **＋ Take a lead down** on the Leads screen.
Somebody phones, or a referral turns up, or the website form falls over: name
and a number is enough, everything else is optional. It lands in the same list
and converts to a job or an estimate the same way.

It needs no connection at all, which is the point — the times you most need it
are the times something else has already failed. These are kept in your own
shop, never written back to the website's table, and a mistyped one can be
deleted outright (a website inquiry can't be, because it isn't yours).

**Photos on a lead** — if the website form collects them, they show as
thumbnails on the lead the moment it arrives, tap for full size, and carry
onto the job or estimate when you book it. People describe plumbing wrong,
reliably; a photo decides whether a job needs an hour of unpaid driving to
quote or can be quoted from the truck.

Setup is [supabase-inquiry-photos.sql](supabase-inquiry-photos.sql) plus a
change to the website form — written up in [FOR-VICTOR.md](FOR-VICTOR.md).
The bucket is private: whoever fills in the form can **insert and nothing
else** — no read, no list, no overwrite, no delete. The app views them through
signed links good for a few minutes.

**Invoices** — the one place that answers "what am I owed?".
Three lists, and work moves left to right:

- **To send** — finished jobs with money on them that nobody has billed yet.
- **Out** — invoices sent and waiting, longest-out first, each showing how many
  days it's been out and when it's due. Past the due date the row turns red and
  says how late it is. A part payment shows what's in and what's left.
- **Paid** — settled, with the date and the method, kept as a record.

Across the top: owed to you, overdue, ready to invoice, and collected this
month. The badge on the tab counts only what needs *you* — work to bill and
invoices gone late. An invoice sent on Tuesday that isn't due until the 15th
needs nothing from anybody, so it doesn't nag.

Saving the PDF moves an invoice from **To send** to **Out** by itself, since
that's the moment it leaves your hands. The other move is a tap: **Money
received** marks it paid in full, tax included, and it drops into Paid.
**Part payment…** opens a sheet with the balance already filled in for anything
less. Marked the wrong one? "Nothing received after all" puts it straight back.

This is deliberately manual, and the screen says so. Stripe (or whoever you
invoice through) takes the money and never reports back — nothing out there
tells the app when a customer pays. So the app asks you rather than guessing,
and stays honest about which of the two of you knows. Nothing here talks to a
payment processor, so there is no integration to break, no keys to rotate, and
no API version to keep up with. Same idea on a signed waiver: there's a field
to link an external copy if you ever send one through DocuSign.

**Customers** — contact details, service address, site notes (gate codes, dogs,
parking, billing quirks), full service history, and lifetime billed.

**Technicians** — the crew, their level, board color, and current load.
Deactivating a tech takes their column off the board without touching their jobs.

**Dispatch tickets** — printable one-page tickets for the truck, with the
problem, site notes, room to write up the work, and a signature line. Print the
whole day from the dashboard or any single job from its detail view.

**Approving an estimate on the spot** — **Sign & approve here** on any estimate
hands them the phone. They see the lines, the total and how long it's good for,
type their name, and sign with a finger. It goes straight to Approved.

This is the one that saves the drive. You're already standing in their
basement with the quote built and the materials list made — getting the
signature there costs nothing, and getting it by email costs a trip back
across the city for a piece of paper.

What they agreed to is **frozen** onto the approval: the lines and the total as
they stood at that moment. Edit the estimate afterwards and the record says so
in red, with the difference, so a changed price can never quietly ride on an
old signature. The signed copy prints with their mark on it instead of a blank
line; an unsigned one still prints blank lines for a pen.

**Getting one signed remotely** — **Send for signature** publishes that one
estimate under a long random token and writes the text or email for you. They
open the link on their phone, read it, type their name, sign with a finger and
tap Approve. It lands back in the app on the next sync and the estimate turns
Approved with their signature on it. The estimate says *Out for signature —
sent 2 days ago* until they do.

Setup is one more SQL file, [supabase-signing.sql](supabase-signing.sql). The
page they open is [sign.html](sign.html) — standalone, no dependencies, works
on any phone.

**The link is the key.** Anyone holding it can see that one estimate and sign
it, the same as any e-signature service, so don't post one publicly. It reaches
nothing else: the customer is never signed in, and `anon` has **no rights on
the table at all** — only permission to call two functions that each demand the
token. An unknown token, an expired one and one that never existed all look
identical from outside. Links expire with the estimate.

The Supabase URL and key travel in the link's `#` fragment, which browsers
never send to a server — so they stay out of access logs on the way, and out of
this repo.

**Sending an estimate** — the **Send to customer** button on any estimate
writes the note for you: the line items, the total, how long it's good for, and
an invitation to call. Edit it however you like, then hand it to your mail app
or Messages — both carry whatever is on screen at that moment. Either one marks
the estimate **Sent**, so it stops showing as a draft, and records it in the
estimate's log.

A browser can't attach a file to your mail app, so if you want the formatted
estimate to go with it, save the PDF first and attach it. The note alone is
often enough when they just want the number.

**Sending the invoice** — **✉ Send it to them** publishes the invoice under a
token and writes the text or email. One tap. They open it on their phone and
see the whole thing — letterhead, the work, before and after, what they
signed, the total — and **pay from the same page**.

A browser cannot attach a file to a text or an email, so the PDF route was
always save, find, attach. This is one tap, and it puts the pay button on the
page they're already reading. **Save as PDF is still there** for the customer
who wants a file for their bookkeeper.

**How they can pay** is set under Data & Setup: a card link (Stripe), an
Interac e-Transfer address, and cash. Anything left blank isn't offered. A job
with its own payment link uses that one instead of the default.

Setup is [supabase-invoice-links.sql](supabase-invoice-links.sql), and the page
is [invoice.html](invoice.html) — standalone, hosted beside the signing page.
Photos live in a private bucket the customer can't reach, so the app mints a
signed link for each one at the moment it sends, lasting as long as the invoice
link does. Nothing in the bucket becomes public. Links expire in 90 days, and
the app can tell you when they opened it.

**Stripe can tell the app when they pay**, once the webhook is wired up
([FOR-VICTOR-2.md](FOR-VICTOR-2.md)). The app puts the invoice's token on the
card link as `client_reference_id`; Stripe hands it back on the event; an Edge
Function writes `paid_at` onto that row; the app marks the job paid on its next
sync, by card, with the Stripe reference on it. The function writes three
columns and never touches the shop.

**Until that's wired, you tap Money received**, same as before — and the tap
still works afterwards for cash and e-transfers.

**The invoice document** — your own, not a retyped copy of one. The **Invoice** button on a
job opens a preview of exactly what the customer will see: letterhead and logo,
who it's billed to, what was wrong, line items, labour, subtotal, GST, total
and the due date. Underneath that, the before-and-after photos and a list of
what they signed. **Save as PDF / Print**, then Share → Save to Files and send
it however you like.

Only labelled photos go on it. An unlabelled one — a model plate, a part number
— stays yours.

Anything signed on the job appears underneath, **with the signature itself** —
what it was, who signed it, when, and their actual mark on the page.

The invoice number is assigned the first time you open the preview and never
changes afterwards, because by then it may be in somebody else's books. A job
with no line items is refused rather than sent blank, and doesn't waste a
number.

Save the PDF and the invoice moves itself onto the **Invoices** screen under
**Out**, with its number as the reference, so you never have to remember to
file it anywhere.

**Payment terms** are a choice, not only a number of days. **On completion of
work** is the default for a shop that gets paid on the spot — the invoice says
so where a due date would go, and no date is calculated. **Due in a number of
days** is there for the commercial customer who needs net 15. Printing "due in
15 days" to somebody standing in front of you with a card is an invitation to
pay in 15 days.

**GST only appears once there is a registration number in settings.** Charging
it before you're registered isn't a formatting mistake, so the document simply
doesn't have a tax line until you fill that field in. What you *earn* stays
pre-tax everywhere in Time & Money, because GST isn't revenue; what the
customer *owes* includes it.

**Photos** — on estimates and on jobs. One or two while quoting so you aren't
reconstructing a basement from memory at nine at night; a before and an after
on the job, which is worth more than a paragraph of notes and takes ten
seconds. They never appear on anything the customer is given.

Photos do **not** go in the shop record — one phone photo is bigger than the
rest of the shop put together. They go to a private Supabase Storage bucket,
and the record keeps only the name. Setup is one more SQL file,
[supabase-photos.sql](supabase-photos.sql), run the same way as the first.

Label each one Before, After, or anything you type — "main stack", "meter",
"under the sink". Tap a photo to view it full size, relabel it, save a copy to
the phone, or delete it. Adding, labelling and deleting all show up in the
job's log alongside clocking in and out.

You never have to guess whether something is still only on the phone. If a
photo hasn't uploaded, Today says so and says it's safe; when it goes up, the
message disappears. It stays quiet for ordinary edits, so when it does speak
it means something.

If iOS throws the app out of memory while the camera is open — it does, and
nothing in a web page can stop it — reopening lands you back on the same job
rather than on Today.

Location data never makes it in. Every photo is re-encoded through a canvas
before it is stored, which drops the EXIF block the camera attaches — GPS
included. A library photo iOS describes as having "Location Is Included"
arrives here with none, so customers' home coordinates are not sitting in the
cloud. There's a test that builds a genuinely geotagged JPEG and checks.

**A photo taken through the app does not go into your camera roll.** That is
how iOS works and a web page cannot change it: the picture is handed to the
app, not to Photos. If you want a copy in your library, either use **Save to
phone** on the photo, or take it with the normal Camera app and attach it with
**From the library**.

It is local-first on purpose. The picture is written to the device the instant
it is taken and shown from there, and uploading happens afterwards when there
is a signal for it. A basement costs you sync, never the photograph — a tile
shows ↑ until it has gone up, and the queue clears itself on the next
connection.

Each one is shrunk to 1600px of JPEG before anything else happens, which is
indistinguishable at the size anyone looks at it and about a tenth the weight:
roughly 3,000 photos inside the free tier rather than 300. The bucket is
private, so nothing in it is reachable by a URL alone — every view is signed
for a few minutes, for you, after you have signed in. These are photographs of
customers' homes.

**Materials and Pick Up** — the private van list. On an estimate and on a
job there's a **Materials** section: one box, type a part, Enter, type the
next. It never appears on a printed estimate, ticket or waiver — this is what
goes in the truck, not what the customer is charged, and the two are different
questions.

The list follows the work. Parts listed while quoting carry into the job when
the estimate converts, marked "quoted", and you add more once you're actually
on site and find out what it really needs.

**Pick Up** is the point of it. One screen gathering every outstanding item
across every open job and estimate, grouped by job, nearest first. Standing in
the aisle you tick things into the cart; anything still showing means don't
drive away yet. One trip for three jobs instead of three trips.

Today's stop cards flag anything still to pick up for that job, so you see it
before setting off rather than on arrival.

Each item takes an optional cost. Fill those in and the job offers the total to
its "what the parts cost you" box in one tap, which is what makes the Time &
Money figures true rather than gross.

**Clock in / clock out** — a button on every stop on Today, and on every job
and estimate record. Hit it when you get there, hit it when you leave. A green
bar sits across the top of the app the whole time it's running so you can't
forget it's going; if it's been running more than eight hours it turns amber and
asks whether you forgot to clock out.

Only one clock runs at a time — starting one stops the other and writes a line
saying so. Entries are listed on the record and every one can be corrected or
deleted, because forgetting to clock out is the normal failure mode, not the
exception. There's an **Add time by hand** button for the trip you didn't clock
at all.

Multiple trips to the same job stack up: you see each one and a total. Time
spent quoting an estimate stays on the estimate, and if that estimate becomes a
job, the job shows **on site**, **plus quoting it**, and an **all in** total.

**Time & Money** — what the clock is for. Pick a window (30 days, 3 months, 6
months, 1 year, all) and it shows, per type of work: how many you did, hours
spent, average time per job, what you billed, and **what you actually earn an
hour** — coloured green, amber or red against the target rate in Data & Setup.
Worst rate first, because that's the row that needs the price change. Under the
table it tells you in dollars what the thinnest work would have to charge to hit
your target.

It also totals the hours you spend quoting, and how many of those went into
quotes you lost — priced at your own rate, because that's real money.

Two honest limits, both of which the view states on screen:

- Under five finished jobs it says so and tells you not to re-price off that
  little. Early numbers are noise.
- The hourly figure is gross until you tell it what parts cost you. A water
  heater will always look like a fantastic hour while the tank's price is
  sitting in the billed column. There's an optional **"What the parts cost
  you"** box on each job; fill it in and the table switches to what you kept.
  Even then it isn't profit — fuel, insurance, the truck and unbilled hours all
  still come out of it.

**Search** — the box at the top finds jobs, estimates and customers by name, address,
email, job number, job type, description, or phone number (digits only work
fine, so `5550231` matches `(435) 555-0231`).

## Sync across your devices

Off by default. The app works fine without it — this only matters once you're
entering real work.

Connect a free Supabase project (**Data & Setup → Sync across your devices**)
and every device you sign in on keeps the same shop, backed up off the phone.
Full setup is in [SUPABASE.md](SUPABASE.md); it takes about ten minutes once,
and the SQL to paste in is [supabase-setup.sql](supabase-setup.sql).

How it behaves:

- Changes go up a couple of seconds after you stop typing. Coming back to the
  app pulls down anything another device did.
- **It works with no signal.** Edits are kept on the device and go up when
  you're back in range. Nothing is lost in a basement.
- **If two devices changed the same shop, it stops and asks.** It never picks
  for you and never silently overwrites. Whichever copy you don't keep is
  downloaded first, so it's always recoverable.
- The server keeps the **last 30 versions** automatically.

Your keys are typed into the app on your own devices and stored there. They are
not in this repo and not in the published link, so nobody holding that link can
reach your data. Row-level security ties every row to your login, so even the
publishable key is useless to anyone without your password.

This is sync, not multi-user — everyone signing in with that one login shares
one shop. The day you hire someone, this needs revisiting.

## Where the data lives

In this browser, on this device, in `localStorage`. With sync switched on there
is also a copy in your own Supabase project; with it off, nothing is uploaded
anywhere. Two consequences worth knowing when it's off:

- Each computer has its own separate copy. The office machine and a laptop will
  not see the same board.
- Clearing site data clears the jobs.
- Signatures are images, so they use more room than anything else here. Each is
  cropped to the ink and runs about 6 KB, which leaves room for several hundred
  signed waivers before a browser's storage limit becomes a problem.

So **Data & Setup → Export JSON backup** is the safety net if you start entering
real work. That file also moves your data to another machine (Import). There
are CSV exports of jobs, estimates and signed waivers for anything you'd rather
open in a spreadsheet.

The app opens with a realistic sample day so you can click around immediately.
**Data & Setup → Reset to sample data** wipes everything and reloads it — which
is also how you clear the samples out once you're ready for real jobs (reset,
then delete the sample jobs, or just start typing over them).

## Company settings

Under Data & Setup: company name and office phone (both appear on printed
tickets) and the default labor rate used to price new jobs. Existing jobs keep
whatever rate they were created with, so changing the rate never rewrites
history.

Name, phone, business email, website, business address and GST registration
number. Everything except the name and phone is optional, and each one prints
on dispatch tickets, estimates and signed waivers only once it's filled in — a
shop with no website yet doesn't print an empty line.

The GST number belongs there once you're registered: an invoice has to show it
before a customer can claim the tax back. Leave the business address blank if
you'd rather not print your home address on documents.

Waiver bodies can merge in `{{company_email}}` alongside `{{company_phone}}`.

## Status flow

Estimates:

    Draft → Sent → Approved → converted to a job
                 ↘ Declined

Leads:

    Website form → inquiries table → Leads → job or estimate

Jobs:

    Unscheduled → Scheduled → Dispatched → In Progress → Complete

Invoices:

    To send → Out → Paid

Saving the PDF makes the first move; you make the second.

`Cancelled` is available at any point on a job. The blue button in the job
detail moves it one step forward; the dropdown next to it jumps anywhere. A
declined estimate can be reopened if the customer comes back.

## About the waiver templates

**These are drafts, not legal advice, and nobody has reviewed them for Alberta.**
They're modelled on language that is common in service plumbing, gas fitting,
drain cleaning and boiler work — the conditions that actually come up, in the
order they come up. What a waiver can disclaim varies by province, and no waiver
anywhere covers gross negligence or willful misconduct.

Have your lawyer and your insurance carrier read them before a customer signs
one. Carriers in particular often have their own preferred wording, and using
theirs can matter at claim time. Every template is editable in the app, so
replacing the language with what they approve is a copy-and-paste job. That
caveat is also shown on the Waivers screen so nobody skips it.

## If this graduates past a prototype

It's deliberately a single file so the office can use it today and tell us what's
wrong with it. The things it does *not* do, in rough order of who'll ask first:

- **Shared data.** Techs and office on the same board needs a backend.
- **A mobile view** for the truck — logging arrival, photos, signature capture.
- **Customer notifications** — "your tech is on the way" texts.
- **Real invoicing** — estimates carry an agreed price, jobs total against it,
  and payment status is tracked by hand, but nothing here sends an invoice or
  moves money. Wiring up Stripe would need a backend, since an API key can never
  live in a browser-only app.
- **Authentication** — anyone at the machine can see and change everything.
- **Signature integrity** — signatures are stored as images alongside the frozen
  text, which is good practice, but there is no tamper-evident audit trail or
  timestamp authority behind them. If waivers ever get contested, that's worth
  revisiting.
