# Park City Plumbing — Service Dispatch

A dispatch board for the office: take service calls, put jobs on the schedule,
assign technicians, and track each job from the phone call to a signed ticket.

**Open `index.html` in a browser.** That's the whole install. It is one
self-contained file — no server, no build step, no accounts, no internet
connection required.

## What it does

**Dashboard** — today at a glance: job counts, open emergencies, anything still
without a technician, and the day laid out tech by tech.

**Schedule board** — a column per technician plus an Unassigned column. Drag a
job card onto a technician to assign it; dropping a new job onto a tech marks it
Scheduled. Step forward and back through days, or jump to any date.

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

**Payment tracking** — each job records whether it's been invoiced and paid, how
much came in, by what method, the invoice reference, and a link to the payment
page. The dashboard shows **Ready to invoice** and **Awaiting payment** as running
totals, and clicking either opens that list. Partial payments and deposits show
the balance owing.

This is deliberately manual. Stripe (or whoever you invoice through) stays the
system of record and keeps doing what it's good at — this just indexes the
outcome so the office can answer "what's outstanding?" without leaving the app.
Nothing here talks to a payment processor, so there is no integration to break,
no keys to rotate, and no API version to keep up with. Same idea on a signed
waiver: there's a field to link an external copy if you ever send one through
DocuSign.

**Customers** — contact details, service address, site notes (gate codes, dogs,
parking, billing quirks), full service history, and lifetime billed.

**Technicians** — the crew, their level, board color, and current load.
Deactivating a tech takes their column off the board without touching their jobs.

**Dispatch tickets** — printable one-page tickets for the truck, with the
problem, site notes, room to write up the work, and a signature line. Print the
whole day from the dashboard or any single job from its detail view.

**Search** — the box at the top finds jobs, estimates and customers by name, address,
email, job number, job type, description, or phone number (digits only work
fine, so `5550231` matches `(435) 555-0231`).

## Where the data lives

In this browser, on this device, in `localStorage` — nothing is uploaded
anywhere. Two consequences worth knowing:

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

## Status flow

Estimates:

    Draft → Sent → Approved → converted to a job
                 ↘ Declined

Jobs:

    Unscheduled → Scheduled → Dispatched → In Progress → Complete

`Cancelled` is available at any point on a job. The blue button in the job
detail moves it one step forward; the dropdown next to it jumps anywhere. A
declined estimate can be reopened if the customer comes back.

## About the waiver templates

**These are drafts, not legal advice, and nobody has reviewed them for Utah.**
They're modelled on language that is common in service plumbing, gas fitting,
drain cleaning and boiler work — the conditions that actually come up, in the
order they come up. What a waiver can disclaim varies by state, and no waiver
anywhere covers gross negligence or willful misconduct.

Have your attorney and your insurance carrier read them before a customer signs
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
