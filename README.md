# Parknav Onsite Survey

A map-first replacement for the old Survey123 form. Surveyors tap a
Parknav-covered street directly on the map and log occupancy for it — no
segment names, no search box, works offline.

## For the field team

1. Open the link you were sent (works in any phone browser, no app install
   needed — optionally tap "Add to Home Screen" for an app-like icon).
2. The first time, enter your name/ID once — it's remembered on that device.
3. Tap any highlighted street on the map.
4. Fill in:
   - **Total parking spots** (required)
   - **Occupied spots** (required)
   - Occupancy % fills in automatically as you type.
   - Optionally: a photo of the segment, time limit, meter rate.
5. Tap **Submit**.
6. If you have no signal, it still saves — you'll see a **"pending"** counter
   at the top. It sends automatically once you're back online. Don't clear
   your browser data before it syncs, or queued entries will be lost.

## For the maintainer (you)

### What this is

A static site (no build step, no framework) using:
- **Leaflet** (vendored locally in `vendor/leaflet/`) + OpenStreetMap tiles
  for the map.
- Plain HTML/CSS/JS for the form and app logic (`js/app.js`).
- **IndexedDB** (`js/idb-queue.js`) to queue submissions offline.
- A **Service Worker** (`sw.js`) to cache the app shell and previously-viewed
  map tiles for offline use.
- A **Google Apps Script Web App** (`apps-script/Code.gs`) + a Google Sheet
  as the free backend, with photos saved to Google Drive.

### File structure

```
survey-app/
  index.html            App shell
  css/style.css         Styles
  js/
    config.js           <- put your deployed Apps Script URL here
    app.js               Map, form, sync logic
    idb-queue.js          Offline queue (IndexedDB)
    photo.js              Client-side photo compression
  data/segments.json     Generated segment dataset (see below)
  vendor/leaflet/         Vendored Leaflet library (no CDN dependency)
  sw.js                   Service worker (offline caching)
  manifest.webmanifest    "Add to Home Screen" metadata
  apps-script/
    Code.gs               Backend script (paste into Apps Script)
    DEPLOY.md             Step-by-step backend deployment guide
```

### Regenerating the segment dataset

`data/segments.json` is generated from `.parking_cache.json` at the repo
root by a script one level up:

```
python build_survey_app_data.py
```

Run this again if `.parking_cache.json` is ever refreshed with new Parknav
coverage data.

### Backend setup (one-time, requires you personally)

See [`apps-script/DEPLOY.md`](apps-script/DEPLOY.md). In short: create a
Google Sheet, paste in `Code.gs`, deploy it as a Web App, then put the
resulting URL into `js/config.js`.

### Publishing to GitHub Pages

This repo folder is meant to become its own GitHub repo
(`github.com/somesh-bagadiya/<repo-name>`), published via GitHub Pages.

**If you have Git installed:**

```bash
cd survey-app
git init
git add .
git commit -m "Initial Parknav onsite survey app"
git branch -M main
git remote add origin https://github.com/somesh-bagadiya/parknav-onsite-survey.git
git push -u origin main
```

Then in the new repo on GitHub: **Settings → Pages → Source: `main` branch,
`/ (root)` folder → Save**. Your link will be:
`https://somesh-bagadiya.github.io/parknav-onsite-survey/`

**If you don't have Git installed** (this dev environment currently does
not): go to [github.com/new](https://github.com/new), create a new **public**
repo named e.g. `parknav-onsite-survey`, then use **Add file → Upload
files** and drag in everything inside this `survey-app/` folder (keep the
folder structure — GitHub's uploader preserves subfolders when you drag a
whole folder in supported browsers). Then enable Pages the same way as above.

### Known limitations

- **Offline map tiles:** only streets/areas the surveyor has already
  scrolled over once (while online) are cached for offline viewing. There
  is no full offline basemap pre-download in this version.
- **Silent sync failures:** because Apps Script Web Apps don't support
  CORS, the app can't fully confirm a submission was accepted server-side —
  see the note in `apps-script/DEPLOY.md`. If entries seem to go missing,
  check the Apps Script **Executions** log first.
- **No login:** anyone with the link can submit, identified only by the
  free-text name they type in once. This was an explicit, intentional
  trade-off for simplicity (see `docs/parknav-segment-survey-webapp-plan.md`).
- **San José coverage only:** the segment set matches the current
  `.parking_cache.json` snapshot; it does not auto-refresh from Parknav.
