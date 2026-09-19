# Come see us — the booking front door

A single static page. No build step, no server, nothing to keep running.

It exists because every booking tool — Calendly, Cal.com, the lot — is built as a
meeting funnel: duration menus, "30 Minute Meeting", a form asking what it's
regarding. That grammar tells the person they're a lead. For friends and family
it's the wrong frame, and restyling doesn't fix it, because the framing is the
problem rather than the colours.

So the machinery sits one click deep and the thing people see is a note.

## Setting it up

**1. Make the booking link.** In Google Calendar: **Create → Appointment
schedule**. Set the length, the hours you'll take visitors, and the buffer.
Name it something human — that name is what people see. Then copy its public
booking page URL.

Free personal Google accounts get exactly one appointment schedule, with no
guest reminders and no email verification. It does check your real calendar, so
a slot with anything in it disappears and you cannot be double-booked. Bookings
land in your calendar and you get an email.

**2. Fill in four things.** Open `index.html`, scroll to `SETTINGS` at the
bottom, and set:

| | |
| --- | --- |
| `bookingUrl` | the link from step 1 |
| `textNumber` | your number, so the fallback works |
| `windows` | roughly when you're around, in your own words |
| `heading` / `lede` / `signoff` | what the page actually says |

Leave `bookingUrl` empty and the page quietly becomes a "just text me" page
instead, with no dead button. That's a legitimate way to run it.

**3. Put it online.** In the repo: **Settings → Pages**, source **Deploy from a
branch**, pick the branch and `/ (root)`. The page lands at
`https://<user>.github.io/<repo>/booking/`.

## What it does not do

It does not read your calendar. Nothing here holds a credential, which is why it
can be a plain public page with no backend. Google decides what's free; this page
only frames the invitation.
