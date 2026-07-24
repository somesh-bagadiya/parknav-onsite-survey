# Deploying the backend (Google Sheet + Apps Script)

This is the one part of the setup that only you (`someshbgd3@gmail.com`) can
do, because Google requires the account owner to manually approve the
script's permissions. It takes about 5 minutes.

## 1. Create the Sheet

1. Sign in to **someshbgd3@gmail.com** and go to [sheets.google.com](https://sheets.google.com).
2. Create a new blank spreadsheet. Name it something like **"Parknav Onsite Survey Responses"**.
3. You do not need to add any columns yourself — the script creates a
   `Responses` tab with headers automatically the first time it runs.

## 2. Add the script

1. In the Sheet, go to **Extensions → Apps Script**.
2. Delete any starter code in the editor.
3. Open [`Code.gs`](./Code.gs) from this repo, copy its entire contents, and
   paste it into the Apps Script editor.
4. Click the save icon (or `Ctrl+S` / `Cmd+S`). Name the project e.g.
   "Parknav Survey Backend".

## 3. Deploy as a Web App

1. Click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Fill in:
   - **Description:** `Parknav survey intake v1`
   - **Execute as:** `Me (someshbgd3@gmail.com)`
   - **Who has access:** `Anyone`
4. Click **Deploy**.
5. Google will ask you to **authorize** the script (this is the manual,
   one-time step only you can do): click **Authorize access**, choose your
   account, click **Advanced → Go to Parknav Survey Backend (unsafe)** if
   Google shows an "unverified app" warning (this is expected for a
   personal script you wrote yourself), then **Allow**.
6. Copy the **Web app URL** shown after deployment. It looks like:
   `https://script.google.com/macros/s/XXXXXXXXXXXXXXXX/exec`

## 4. Wire it into the app

1. Open `survey-app/js/config.js` in this repo.
2. Replace `PASTE_YOUR_DEPLOYED_WEB_APP_URL_HERE` with the URL you just copied.
3. Save the file (this repo, not the Apps Script editor).

## 5. Test it

Open the Web app URL directly in a browser tab — you should see:

```
Parknav Survey API is running.
```

Then submit one test entry from the survey app itself (see the main
`survey-app/README.md`) and confirm a row appears in the `Responses` tab
within a few seconds. Photos (if attached) will appear as files inside a
**"Parknav Survey Photos"** folder in your Google Drive, with the link
saved in the `PhotoUrl` column.

## Known limitation: silent failures

Because Apps Script Web Apps don't send CORS headers, the app sends
submissions with `fetch(..., { mode: "no-cors" })`. This means the browser
can tell if the *network request* went out, but cannot read whether Apps
Script actually succeeded or threw an error. In practice this is reliable
as long as the deployment above is done correctly and the payload format
doesn't change — but if rows stop appearing, the first place to check is
**Apps Script → Executions** (left sidebar) for error logs, not the browser
console.

## If you ever need to update the script

Every time you edit `Code.gs` and want the live URL to reflect the change,
use **Deploy → Manage deployments → (pencil/edit icon) → New version →
Deploy**. Editing the code alone does *not* update the already-deployed
Web app URL.

## Updating from an earlier version (SegmentLat/SegmentLng columns added)

If you deployed before and already have a `Responses` sheet with data in it,
the code now writes two extra columns (`SegmentLat`, `SegmentLng`, inserted
right after `SegmentName`) so every submission can be matched to an exact
map location, not just an ID. Since the header row is only auto-created the
*first* time the sheet is created, you need to manually keep it in sync:

1. Open your `Responses` tab.
2. Right-click the column header where `TotalSpots` currently is, and
   **Insert 2 columns left**.
3. Label the two new columns `SegmentLat` and `SegmentLng` (matching the
   `COLUMNS` list at the top of `Code.gs`).
4. Re-paste the updated `Code.gs` into the Apps Script editor (replacing the
   old version) and redeploy: **Deploy → Manage deployments → pencil icon →
   Version: New version → Deploy**. The Web app URL stays the same, so
   `js/config.js` does not need to change.

If your `Responses` sheet only has test data so far, it's simplest to just
delete the sheet/tab entirely and let the script recreate it (with the
correct headers) on the next submission.

## New endpoint: "already-submitted segments"

`GET <your-web-app-url>?action=submittedSegments` returns a JSON array of
every distinct `SegmentId` that has at least one submission. The map app
uses this to shade streets gold for the whole team, not just the device
that submitted them. This requires the same redeploy step above to take
effect. It's best-effort: if it's unreachable for any reason, the app
silently falls back to only showing segments *this device* has submitted.

## "LatestBySegment" tab (handles a street being surveyed more than once)

A street can legitimately get more than one submission (re-checks,
corrections, different times of day). `Responses` is an append-only log —
it keeps every submission ever made and is never rewritten, so nothing is
ever lost. Alongside it, the script now also maintains a second tab called
**`LatestBySegment`**, which always has exactly one row per `SegmentId`,
overwritten in place with that segment's most recent submission. Use this
tab whenever you want "what's the current state of every street" without
having to manually filter out older duplicate rows in `Responses`.

This tab is created and kept in sync automatically — you don't need to do
anything for new submissions. If you already had submissions in `Responses`
*before* deploying this version, run the one-time backfill so
`LatestBySegment` reflects that existing data too:

1. In the Apps Script editor, use the function dropdown (next to the **Run**
   button, at the top) to select **`rebuildLatestSheet`**.
2. Click **Run**. The first time, you may need to re-authorize (same as the
   initial deployment).
3. Check the Sheet — a `LatestBySegment` tab should now exist with one row
   per already-submitted street.

You can re-run `rebuildLatestSheet` any time you want to force the two tabs
back into agreement (it fully recreates `LatestBySegment` from whatever is
currently in `Responses`).

## New endpoint: "segment details" (powers the preview + edit feature)

`GET <your-web-app-url>?action=segmentDetails&segmentId=seg_0145` returns
how many times a street has been submitted and its most recent submission's
full details (read from `LatestBySegment`). The app uses this to show a
preview ("Submitted 2 times, last: 5/10 spots, 50%, by Somesh...") with
"Add new observation" / "Edit" options whenever someone taps a
already-gold street, instead of jumping straight into a blank form. This
also requires the same redeploy step above.
