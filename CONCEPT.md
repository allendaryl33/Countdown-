# Life Dispatch — a personal-life dashboard

Working notes for the app in `dispatch/`. Written after reading a month of the
actual calendar, so the shape is fitted to a real week rather than a generic one.

## The problem, stated precisely

Victor (OpenClaw) already handles **intake**: you talk, he writes to Google
Calendar. That half works. What's missing is the other half — nothing captures
what came *out* of any of it. The calendar knows Men's Group was Wednesday at
6:00. It has no idea what was said, what you committed to, or whether you went.

So the gap isn't scheduling. It's **close-out**.

## Why the service-app dashboard is the right borrow

A field-service dashboard (ServiceTitan, Jobber, Housecall Pro) is built around
one rule: *a job isn't closed until the tech writes it up.* The dispatcher
books it, the tech does it, and then someone records what was found and what
still needs doing. That write-up is what makes the customer history, the
call-back list, and next week's schedule all work.

The mapping to a personal life is unusually clean:

| Service business | Here |
| --- | --- |
| Dispatch board | Today's blocks, live from Google Calendar |
| Job / work order | One calendar block you can open |
| Tech's write-up | What actually happened, in your words |
| Job status | Cleared / missed / moved — not merely "scheduled" |
| Call-backs | Open loops, carried across blocks until closed |
| Customer history | Every past touch with a person, in one place |
| Recurring contracts | Your standing rhythms |
| Dispatcher | Victor |

The reason this metaphor beats the usual "Life OS" framing: it's built around
**closing** things, not collecting them. Most personal dashboards are inboxes
that only grow.

## What the calendar already says about the week

*Read off an earlier Google account; the app itself is account-agnostic — it
follows whichever calendar the viewer's connector is authorised to, and
discovers the rest at runtime. The rhythm below describes the life, not the
account, and is the shape the board is designed around.*

Reading the current recurring blocks, the operating rhythm is already there:

- A daily open (`Prepare for the day`) and a long `Marketing & Sales` block.
- `Life Mapping`, 17:00, five days a week.
- `Toastmasters` Thursdays, `Men's Group` Wednesdays, `Saso U` twice weekly.
- `Date Night` alternating between the two of you, week to week.
- `Budget calendar` then `Plan/Assess week with Jess`, back to back on Sunday.
- Bins, mortgage, `Baby Lap time`.

Two things follow from that. First, **the Sunday `Plan/Assess` block is the
natural home for this app** — that's the meeting the dashboard should be
feeding. Second, the blocks are already colour-coded in Google Calendar, so the
dashboard should inherit that colour language rather than invent a second one.
It does: every stripe is your own `colorId`.

## What's out there, and why none of it fits

- **Notion "Life OS" templates** — the biggest category. Beautiful, and they
  rot. They ask you to maintain databases by hand, and they don't know your
  calendar. ([templates roundup](https://pathpages.com/blog/notion-life-os))
- **[Life OS](https://life-os-me.vercel.app/)** and the `life-os` projects on
  [GitHub](https://github.com/topics/life-os) — open-source, self-hostable,
  local-first. Closest in spirit; heavy to run, and still built around
  habits/finance/journal modules rather than a live schedule.
- **[Lifely](https://www.lifelyapp.online/)** — one gentle daily dashboard,
  tasks + habits + mood + weekly review. Right emotional register, wrong data
  source: it wants you to enter everything again.
- **Gyroscope / Exist** — passive sensor correlation. Answers "how did I
  sleep", not "what did I commit to on Wednesday".
- **[Best life dashboard apps 2026](https://xenith.life/articles/best-life-dashboard-apps)**
  is a decent survey of the field.

The common failure: they're all *second* places to type things. The one thing
this app must never become is a database you feed by hand. It reads the
calendar you already keep, and asks for one thing back — the write-up.

## v1 (built)

`dispatch/index.html`, a single page, no build step, published as an Artifact.

- **Live board.** Today + tomorrow, straight from Google Calendar through the
  viewer's own connector, watched and refreshed. Multiple calendars via chips.
- **Close-out panel.** Per block: status, "what actually happened", who was in
  it, and open loops. Autosaved.
- **Open loops.** Every unclosed loop from every block, in one list, carried
  until ticked.
- **Week close-out.** Drafts "what held / what slipped / still open / one thing
  to change" from the week you actually recorded — for the Sunday session.
- **Move a block.** Picking `Moved` opens a month grid; choosing a day records
  the destination, and a separate confirm button reschedules the event in
  Google Calendar. Verified against the live API on a throwaway recurring
  event: passing the instance id moves that occurrence only, the series is
  left alone, and the duration carries across. Nothing is written until the
  second, deliberate tap.
- **People.** A second view on the board column: everyone you've logged, most
  recent first, with how many blocks, how many loops are still open with them,
  and how long it's been. Pick someone for their full thread — every block,
  every write-up, every loop — and the open-loops card filters to them. Each
  person takes the calendar colour they show up in most.
- **To-dos.** Victor drops them on a calendar; the dashboard adopts them and
  owns them from there. Anything on a calendar named *To-dos*, or any event
  titled `TODO: something`, becomes a to-do rather than a block — checked off,
  moved to another day, or dropped, all in the dashboard's own store. Today's
  and overdue ones ride at the top of the board. Once done, one tap clears the
  original event off the calendar so it doesn't silt up.

  Note that Google Calendar has no to-do event type — the types are `DEFAULT`,
  `OUT_OF_OFFICE`, `FOCUS_TIME`, `WORKING_LOCATION`, `BIRTHDAY`, `FROM_GMAIL`.
  What looks like one in the Calendar app is **Google Tasks**, a separate
  product with a separate API and no connector here. Hence the calendar-as-inbox
  approach: it needs nothing that doesn't already exist.
- **Projects.** A project is a tag, not a container. Anything tagged into one
  keeps its own workflow where it lives *and* shows under the project, which is
  the whole point: a to-do stays a to-do, and the project sees it. Say it any
  way it comes out — `Call Snowbird #yard`, `[Yard] Order topsoil`, or
  `Project: Yard` in the note. Tagged items name projects into existence, so
  there is no roster to maintain. Each project carries a plan, what's still to
  do, what's done, and the blocks already written up against it — so the
  breakdown and the time actually spent sit on one screen.
- **Phases.** Two levels, parent and phase, and deliberately no more: a phase
  holds to-dos, never more phases. `#backyard/grade` files an item into the
  Grade phase of Backyard; `#backyard` alone files it at project level. Roll-up
  is derived rather than tracked — the parent counts everything beneath it, so
  "2 of 8 done" needs no bookkeeping. A project's id is its tag and its name is
  a label you can edit, so Victor keeps saying `#backyard` while the dashboard
  reads *Backyard Landscape*. The detail panel shows the tag for exactly that
  reason: it is what to tell Victor.
- **Filing an item.** Victor lands everything in To-dos through the calendar.
  Deciding it belongs to a project happens later, in one of three ways: drag the
  to-do onto a project or phase, pick one from the to-do's editor, or let a tag
  do it at intake. Drag is a pointer gesture and touch devices do not fire it,
  which is why the picker exists alongside.
- **Tasks vs to-dos.** `TODO:` is dated work that belongs to a day and shows on
  the board, and lives in the To-dos tab. `TASK:` is a step in a project: no
  date, shown with a dash, and living in its own Tasks tab grouped by project.
  Either can be turned into the other from its editor, so a misfiled item is
  one dropdown away from the right tab. The distinction is the
  point — "call Billy Bob at 8" and "lay the base" are not the same kind of
  thing and should not compete for the same attention.
- **Dictated tags.** A spoken hashtag arrives with spaces — `#fire pit area` —
  and has no closing marker. The parser matches as many of its words as name
  something that already exists, longest first, and otherwise takes up to four
  as a new tag. So `#firepit` finds Backyard › Fire Pit without the parent
  having to be said aloud every time.
- **Range.** Today / 2 days / Week, remembered per browser. A clear day says so
  rather than vanishing, so an empty board never reads as a broken one.
- Colour comes from your Google Calendar `colorId`. Nothing invented.

Notes live in the Artifact's own store, which means Claude can read them back
later — ask for last month's Men's Group notes and they're there.

## Where it goes next

1. **Two-way with Victor.** Write the close-out into the calendar event's
   `description` or an extended property. Then it's durable, it syncs to your
   phone, and Victor can read it — "what did I commit to at Men's Group?"
   becomes answerable without a second database.
2. **People, deeper.** The view exists; the obvious next steps are merging
   spellings of the same person by hand ("Jess" vs "Jessica"), and pulling
   attendees off the calendar event so you don't have to type who was there.
3. **Rhythm adherence.** `Life Mapping` is on the board 5×/week — how many
   actually held? The gap between the standing rhythm and the cleared blocks is
   the most honest metric in the app.
4. **Voice capture.** You already talk to Victor. "Victor, close out Men's
   Group: talked about X, I owe Dave a call" should land here.
5. **Sunday mode.** Reshape the whole page for the `Plan/Assess` block: the
   week in review on the left, next week's board on the right.

## Open questions

- Does the write-up belong in the calendar event, or in its own store? Calendar
  is durable and Victor-readable; a store is faster and holds structure. The
  roadmap assumes calendar-as-truth with the store as a cache — worth deciding
  before going further.
- How much should Jess see? A shared board changes the design a lot.
- Is "missed" a status worth having, or does it just accumulate guilt?
