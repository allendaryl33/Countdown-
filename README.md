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

**Jobs** — every job, filterable by status, technician, type, and open/closed.
Each job carries the customer, address, reported problem, arrival window,
priority, parts used, labor hours, a running total, and a timestamped activity
log of every status change and note. A job created from an estimate carries the
quoted price and shows what it's running over or under once the tech adds
parts.

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

So **Data & Setup → Export JSON backup** is the safety net if you start entering
real work. That file also moves your data to another machine (Import). There
are CSV exports of jobs and of estimates for anything you'd rather open in a
spreadsheet.

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

## If this graduates past a prototype

It's deliberately a single file so the office can use it today and tell us what's
wrong with it. The things it does *not* do, in rough order of who'll ask first:

- **Shared data.** Techs and office on the same board needs a backend.
- **A mobile view** for the truck — logging arrival, photos, signature capture.
- **Customer notifications** — "your tech is on the way" texts.
- **Real invoicing** — estimates carry an agreed price and jobs total parts and
  labor against it, but nothing here sends an invoice or takes payment.
- **Authentication** — anyone at the machine can see and change everything.
