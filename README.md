# Health Log

A personal, offline-first app for logging workouts, bodyweight, food, water, sleep, mood, supplements — and anything else you define — then seeing whether you're progressing.

**Live:** https://dissavage.github.io/Gym-Log/

- No accounts, no backend, no tracking. Everything stays on the device.
- Plain HTML/CSS/JS with no build step: open `index.html` or serve the folder statically.
- Works offline once loaded (service worker), and installs as an app.

## Install on iPhone

1. Open the link in **Safari** → **Share** → **Add to Home Screen**.
2. Open Health Log from the new icon.

A Home Screen app keeps its **own storage, separate from Safari**. Install first, then add or import your data inside the installed app.

## What it does

| Area | Highlights |
|---|---|
| **Today** | One-tap/two-tap logging tiles, totals vs daily goals (with +8/+16 oz water chips), supplements checklist, today's log, backup reminder |
| **Workout** | Start empty, from a template, or "repeat last"; sets pre-fill from last time with "last 185×8" inline; thumb steppers, RPE/RIR, warm-up/working/drop/failure sets; swipe to delete, drag to reorder; automatic rest timer that survives tab switches and reloads; PR toasts; draft autosaves on every tap |
| **History** | Every log in one feed by day, filter by tracker, tap to edit; loads 50 at a time |
| **Insights** | Streaks + calendar heat map; weekly working sets per muscle vs target bands; per-exercise estimated 1RM (Epley — an estimate), PR log and progress chart; bodyweight with a 7-day moving average; chart any numeric field over 7D/30D/90D/1Y/All, each with a data-table view |
| **Custom trackers** | Build your own: number (with any unit), 1–5 scale, yes/no, duration, text, time; daily goals, quick-add buttons. They get logging, goals, history and charts automatically |
| **Data** | Full JSON backup + restore with a preview (never a blind overwrite), CSV per tracker, import from the old Gym Tracker, storage-persistence status, demo data, delete-all |

## Your data

- **Backups:** More → **Back up everything** saves one JSON file (share sheet → Save to Files / iCloud Drive). The app reminds you after 14 days without one.
- **Restore:** More → **Restore from backup** shows what will be added, updated (only if newer) or skipped before writing. Nothing is deleted. Export → delete all → import restores everything exactly.
- **Old Gym Tracker:** in the old app, Home → ⚙ → **Export for Health Log** (read-only), then here: More → **Import from old Gym Tracker**. Re-importing never duplicates.
- **Demo data:** More → **Load demo data** adds ~6 months of clearly tagged sample logs; **Remove demo data** deletes exactly those.

## Development

No dependencies to install. Serve the folder with any static server (a service worker needs `http://localhost`, not `file://`; the app itself also runs from `file://` without offline mode):

```sh
npx serve .            # or: python -m http.server 8080
```

- **Tests:** open `/tests.html` — pure-function tests (units, dates, migrations, tracker engine, e1RM, PRs, weekly volume, moving average, streaks, backup/import dedupe, CSV, old-app mapper, demo data). It should read "N passed, 0 failed".
- **Chart.js** 4.4.1 is loaded from cdnjs (pinned, with SRI) only when a chart is shown, and is precached for offline use.

### Releasing

GitHub Pages serves the repo root. On every release:

1. Bump the `?v=` query on all `<link>`/`<script>` tags in `index.html` **and** `VERSION` in `sw.js` (keep them in step). Add any new file to `ASSETS` in `sw.js`.
2. Run `tests.html`, push, wait for the Pages build, and load the live site once.
3. Installed apps then show **"A new version is ready — Refresh"**.

### Structure

```
index.html        app shell (tabs, sheet/toast roots), theme set before first paint
styles.css        design tokens (dark default, optional light) + components
sw.js             offline caching: network-first HTML, cache-first assets, versioned caches
manifest.json, icons/
js/util.js        dates (local-day keys), formatting, ids, small DOM helpers
js/units.js       canonical units (kg, ml, km, cm, min) ↔ display units
js/schema.js      IndexedDB layout, built-in trackers, exercise library, migration runner
js/domain.js      pure logic: aggregates, goals, e1RM, PRs, weekly volume, trends, tracker builder rules
js/backup.js      pure backup build/validate/diff and CSV
js/legacy.js      pure old-Gym-Tracker → Health Log mapper
js/demo.js        pure demo-data generator
js/db.js          the only file that touches IndexedDB
js/repo.js        in-memory cache + write queue (failed writes are kept and retried, never dropped), settings
js/app.js         boot, tab router, targeted re-rendering, update banner, theme
js/ui/*.js        one file per view or component (today, workout, history, insights, settings, sheet, …)
tests.html, tests/tests.js
```

### Data model (IndexedDB `healthlog`)

Every record has `id`, `type`, `timestamp` (local ISO with offset), `createdAt`, `updatedAt`, `deletedAt` (soft delete, purged after 30 days), `notes`, and `source` (set for imported/demo records so re-imports dedupe).

- `entries` — every log. `type` is the tracker key; `dayKey` is the local date; `values` hold canonical units. A workout's `values` contain exercises → sets `{ weightKg, reps, rpe, rir, setType, restSec, done }`.
- `trackers` — field-driven definitions (built-ins and custom) that power forms, aggregates, goals and charts.
- `exercises`, `templates`, `presets`, `checklistItems`, `drafts`, `meta`.

Schema changes go through `HL.schema.MIGRATIONS` (pure `up(snapshot)` steps), which also upgrade older backups on import. Settings live in `localStorage` under `healthlog.settings`; nothing is written under the old app's `gym_*` keys.
