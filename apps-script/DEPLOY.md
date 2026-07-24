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
