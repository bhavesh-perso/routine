# Settings, backup and calendar export

Files: `js/settings.js`, `js/ics.js`, `styles/settings.css`, `tests/settings.test.js`, `tests/ics.test.js`.

## Settings screen (`#/settings`, `#/settings/<section>`)

Eight `details.fold` sections: `shifts`, `overrides` (changed days), `sleep`, `gym`, `food`, `study`,
`progress`, `data`. A link such as `#/settings/data` opens that section and scrolls to it. Which
sections are open is kept in module memory, so re-rendering after a save doesn't collapse them.

Every field saves on `change` (when you leave it) through `setSetting(path, value)` and shows
"Saved". Inputs carry `data-act="set-field" data-path="…" data-kind="time|date|int|text|url"`.
Checkboxes use `set-bool`; equipment uses `set-equip` (`data-gym`, `data-item`).

Validation happens before anything is saved. Invalid values stay in the field (kept as a draft),
get an inline error and `aria-invalid`, and nothing changes in storage:
- Block length and anchor go through `schedule.validateSettings` (block length must be a multiple of 14).
- Times must be `HH:MM`. A shift or sleep window can't start and end at the same minute.
- The exam has to be after the study start.
- Numbers respect the input's `min`/`max`.
- Gym slots are stored as one `'HH:MM-HH:MM'` string (`s.gymSlots.<dayType>`). The screen shows two
  inputs (`data-path="gymSlots.nightOff#0"` / `#1`), and the end has to be after the start.
- Dumbbell lists (`s.dumbbells.home|work`) are typed as `2, 4, 6`. `parseDumbbells` accepts commas,
  semicolons, spaces and an optional `kg`, removes duplicates, sorts them and rejects anything
  outside 0–100 kg.

Sleep: each day type has a sleep and wake time. Wake = the end of the window (storage derives
`s.wake` from it). The screen shows each window's length and never suggests a longer one.

## Changed days (overrides)

`s.overrides[iso] = { kind, block?, start?, end? }`. Week/day screens set overrides too, but this
list is the one place to see them all. Upcoming ones are listed first; past ones are folded away.
- `addOverride(iso, kind, start?, end?)`: `kind` is `off | sick | leave | work-night | work-morning | custom`.
  `work-*` becomes `{ kind:'work', block }`. A `custom` shift gets `block:'night'` if it starts at or after
  12:00 or runs past midnight, otherwise `'morning'` (the same rule as week.js). That block decides which sleep rules apply.
- `clearOverride(iso)` deletes the key, so the pattern applies again.

## Backup

- **Export:** `exportAll()` → `routine-backup-YYYY-MM-DD.json`. `shareOrDownload(text, name, type)`
  uses `navigator.share({ files })` when `navigator.canShare({ files })` allows it. On iPhone that
  opens the share sheet, where you pick Save to Files / iCloud Drive. Otherwise it falls back to an
  `<a download>` with an object URL. `markBackup()` runs after a share or download. It does not run
  if you cancel the share sheet (`AbortError`). Any other share error falls back to a download.
  Safari only allows `share()` straight from a tap, so the export handler doesn't await anything first.
- **Import:** a file input (`accept="application/json,.json"`, `data-act="set-import"`) is laid over the
  "Import backup" button. The flow is: read the text, `JSON.parse`, `parseImport(obj, ctx.iso)` (this
  validates and migrates v1), show counts per area in a `confirm()`, then `replaceAll()`. Errors appear as
  an alert note under the buttons. Nothing is written until you confirm.
- **Reset all data:** two `confirm()` dialogs, then `resetAll()`.
- **Stored size:** `sizeBytes()` in KB, next to the ≈ 5 MB localStorage limit.

`backupBanner(ctx)` (used on Today) returns a quiet `.note.calm` with a link to `#/settings/data` when:
- the last backup is more than 14 days old (by Mauritius date) → "Last backup was N days ago."
- there has never been a backup and `meta.firstUse` is more than 14 days old → "You haven't exported a backup yet."

Otherwise it returns `''`, which includes a fresh install with no data.

## Calendar export (`js/ics.js`)

`buildIcs(s, fromIso, days = 56, { now })` → RFC 5545 text. Export calendar starts from the routine
day (so a night shift that is under way is included) and covers 8 weeks.

- Events are the `shift`, `gym`, `study` and `weigh` blocks of `plan.dayPlan(iso, s)`, so the calendar
  matches the app exactly. Gym blocks only exist once the app has registered the gym provider
  (`plan.setProviders`). The tests register a stub.
- Times are local, `DTSTART;TZID=Indian/Mauritius:…`, with a `VTIMEZONE` that has one `STANDARD`
  component (+0400 → +0400, no DST). Block minutes ≥ 1440 roll to the next date (a night shift on
  28 Oct ends `20261029T070000`). Negative minutes roll to the previous date. `DTSTAMP` is UTC.
- Weigh-ins (5 min in the plan) are stretched to 10 min so they show properly in Calendar.
  Shifts are `TRANSP:OPAQUE` (busy); everything else is `TRANSPARENT`.
- Every event has `BEGIN:VALARM / ACTION:DISPLAY / TRIGGER:-PT15M`.
- UIDs: `YYYYMMDD-<kind>@routine.bhavesh-perso`, plus `-1`, `-2` when a day has more than one block of
  the same kind. The same plan always produces the same UIDs. Changing settings that move a block to
  another date changes that event's UID.
- Lines end in CRLF and are folded at 75 octets (UTF-8 safe). Text is escaped (`\\ \; \, \n`).

### Importing on iPhone

1. Settings → Backup and data → **Export calendar (.ics)** → in the share sheet, choose **Save to Files**
   (or AirDrop / Mail it to yourself).
2. Open `routine-calendar.ics` from Files (or the mail attachment). iOS shows the events with
   **Add All**. Tap it and choose a calendar.
3. Use a dedicated calendar: first create one called **Routine** in the Calendar app
   (Calendars → Add Calendar). Then the imported events are easy to hide, check or delete in one go.

### What re-importing does on iPhone

The file carries stable UIDs, and some calendar apps use them to update events instead of
duplicating them. Don't rely on that with iOS Calendar: importing a file with Add All generally
adds the events again, so you get duplicates. To refresh the 8 weeks (for example after changing
shift times or adding a changed day):
1. Delete the old events first. The simplest way is to delete the whole **Routine** calendar
   (Calendar → Calendars → ⓘ next to Routine → Delete Calendar), then create it again.
2. Import the fresh file into it.

The alerts are ordinary calendar alerts, so they work with the app closed. That is why the app uses
this instead of push notifications.

## Tests

`node tests/settings.test.js` and `node tests/ics.test.js` (in-memory localStorage, no DOM).
