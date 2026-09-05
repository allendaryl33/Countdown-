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

**Jobs** — every job, filterable by status, technician, type, and open/closed.
Each job carries the customer, address, reported problem, arrival window,
priority, parts used, labor hours, a running total, and a timestamped activity
log of every status change and note.

**Customers** — contact details, service address, site notes (gate codes, dogs,
parking, billing quirks), full service history, and lifetime billed.

**Technicians** — the crew, their level, board color, and current load.
Deactivating a tech takes their column off the board without touching their jobs.

**Dispatch tickets** — printable one-page tickets for the truck, with the
problem, site notes, room to write up the work, and a signature line. Print the
whole day from the dashboard or any single job from its detail view.

**Search** — the box at the top finds jobs and customers by name, address,
email, job number, job type, description, or phone number (digits only work
fine, so `5550231` matches `(435) 555-0231`).

## Where the data lives

In this browser, on this device, in `localStorage` — nothing is uploaded
anywhere. Two consequences worth knowing:

- Each computer has its own separate copy. The office machine and a laptop will
  not see the same board.
- Clearing site data clears the jobs.

So **Data & Setup → Export JSON backup** is the safety net if you start entering
real work. That file also moves your data to another machine (Import). There's
a CSV export of all jobs for anything you want to open in a spreadsheet.

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

    Unscheduled → Scheduled → Dispatched → In Progress → Complete

`Cancelled` is available at any point. The blue button in the job detail moves a
job one step forward; the dropdown next to it jumps anywhere.

## If this graduates past a prototype

It's deliberately a single file so the office can use it today and tell us what's
wrong with it. The things it does *not* do, in rough order of who'll ask first:

- **Shared data.** Techs and office on the same board needs a backend.
- **A mobile view** for the truck — logging arrival, photos, signature capture.
- **Customer notifications** — "your tech is on the way" texts.
- **Real invoicing** — this totals parts and labor, but it does not send
  invoices or take payment.
- **Authentication** — anyone at the machine can see and change everything.
