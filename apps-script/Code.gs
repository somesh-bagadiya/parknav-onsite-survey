/**
 * Parknav Onsite Survey - Apps Script backend.
 *
 * Deploy as a Web App (Deploy > New deployment > Web app), access "Anyone".
 * See DEPLOY.md in this folder for full step-by-step instructions.
 *
 * Responsibilities:
 *   - Accepts a JSON submission via POST.
 *   - Saves an optional photo (base64) to a Drive folder.
 *   - Appends one row per submission to the "Responses" sheet (created
 *     automatically, with headers, on first run).
 *   - Skips duplicate rows if the same clientId is received twice (the
 *     frontend may retry a submission that actually already succeeded).
 */

const SHEET_NAME = "Responses";
const LATEST_SHEET_NAME = "LatestBySegment";
const PHOTO_FOLDER_NAME = "Parknav Survey Photos";

const COLUMNS = [
  "ServerReceivedAt",
  "SubmittedAtLocal",
  "SubmitterName",
  "SegmentId",
  "SegmentName",
  "SegmentLat",
  "SegmentLng",
  "TotalSpots",
  "OccupiedSpots",
  "OccupancyPct",
  "TimeLimitHours",
  "MeterRate",
  "PhotoUrl",
  "ClientId",
];

function doGet(e) {
  // e is undefined when this is run manually from the Apps Script editor
  // (there's no real HTTP request behind it) rather than hit as a URL - guard
  // against that so a manual test-run doesn't throw.
  const action = e && e.parameter && e.parameter.action;
  if (action === "submittedSegments") {
    return jsonResponse(getDistinctSegmentIds());
  }
  if (action === "segmentDetails") {
    return jsonResponse(getSegmentDetails(e.parameter.segmentId));
  }
  return ContentService.createTextOutput(
    "Parknav Survey API is running."
  ).setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Powers the "this street was already submitted" preview in the app: how
 * many times it's been submitted, and the full details of the most recent
 * submission (read from LatestBySegment, since that's already deduped and
 * far cheaper to query than scanning all of Responses for every tap).
 * Used by the "GET ?action=segmentDetails&segmentId=..." endpoint.
 */
function getSegmentDetails(segmentId) {
  if (!segmentId) return { count: 0, latest: null };
  return {
    count: countSubmissionsForSegment(segmentId),
    latest: getLatestRowForSegment(segmentId),
  };
}

function countSubmissionsForSegment(segmentId) {
  const sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const colIndex = COLUMNS.indexOf("SegmentId") + 1;
  const ids = sheet.getRange(2, colIndex, lastRow - 1, 1).getValues();
  let count = 0;
  ids.forEach((row) => {
    if (row[0] === segmentId) count++;
  });
  return count;
}

function getLatestRowForSegment(segmentId) {
  const sheet = getOrCreateLatestSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const segIdColIndex = COLUMNS.indexOf("SegmentId") + 1;
  const values = sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][segIdColIndex - 1] === segmentId) {
      return rowToObject(values[i]);
    }
  }
  return null;
}

function rowToObject(row) {
  const obj = {};
  COLUMNS.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return obj;
}

/**
 * Returns every distinct SegmentId that already has at least one submission,
 * so the map app can shade already-covered streets for the whole team (not
 * just the current device). Used by the "GET ?action=submittedSegments"
 * endpoint.
 */
function getDistinctSegmentIds() {
  const sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const colIndex = COLUMNS.indexOf("SegmentId") + 1;
  const values = sheet.getRange(2, colIndex, lastRow - 1, 1).getValues();
  const seen = {};
  const result = [];
  values.forEach((row) => {
    const id = row[0];
    if (id && !seen[id]) {
      seen[id] = true;
      result.push(id);
    }
  });
  return result;
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const sheet = getOrCreateSheet();

    if (payload.clientId && isDuplicate(sheet, payload.clientId)) {
      return jsonResponse({ status: "duplicate_ignored" });
    }

    let photoUrl = "";
    if (payload.photoDataUrl) {
      photoUrl = savePhoto(payload.photoDataUrl, payload.clientId || Utilities.getUuid());
    }

    const row = [
      new Date(),
      payload.submittedAtLocal || "",
      payload.submitterName || "",
      payload.segmentId || "",
      payload.segmentName || "",
      payload.segmentLat ?? "",
      payload.segmentLng ?? "",
      payload.totalSpots ?? "",
      payload.occupiedSpots ?? "",
      payload.occupancyPct ?? "",
      payload.timeLimitHours ?? "",
      payload.meterRate ?? "",
      photoUrl,
      payload.clientId || "",
    ];

    sheet.appendRow(row);
    upsertLatestRow(row);

    return jsonResponse({ status: "ok" });
  } catch (err) {
    return jsonResponse({ status: "error", message: String(err) });
  }
}

/**
 * A street can legitimately be surveyed more than once (re-checks, corrections,
 * different times of day). "Responses" keeps every submission ever made as a
 * full history/audit trail and is never rewritten. This keeps a second tab,
 * "LatestBySegment", with exactly one row per SegmentId - always overwritten
 * in place with that segment's most recent submission - as a convenience view
 * for reporting on "current" occupancy without having to dedupe manually.
 */
function upsertLatestRow(row) {
  const sheet = getOrCreateLatestSheet();
  const segIdColIndex = COLUMNS.indexOf("SegmentId") + 1;
  const segmentId = row[segIdColIndex - 1];
  const lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    const ids = sheet.getRange(2, segIdColIndex, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === segmentId) {
        sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }
  sheet.appendRow(row);
}

function getOrCreateLatestSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(LATEST_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(LATEST_SHEET_NAME);
    sheet.appendRow(COLUMNS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * One-time helper for submissions that already existed before this feature
 * was added (or to fix drift if the two tabs ever disagree): rebuilds
 * "LatestBySegment" from scratch using everything in "Responses". Run this
 * manually from the Apps Script editor - select "rebuildLatestSheet" in the
 * function dropdown next to the Run button, then click Run - it is not
 * triggered automatically by any submission.
 */
function rebuildLatestSheet() {
  const responses = getOrCreateSheet();
  const lastRow = responses.getLastRow();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existing = ss.getSheetByName(LATEST_SHEET_NAME);
  if (existing) ss.deleteSheet(existing);
  const latest = ss.insertSheet(LATEST_SHEET_NAME);
  latest.appendRow(COLUMNS);
  latest.setFrozenRows(1);

  if (lastRow < 2) return;
  const segIdColIndex = COLUMNS.indexOf("SegmentId") + 1;
  const allRows = responses.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues();
  const bySegment = {};
  allRows.forEach((row) => {
    const id = row[segIdColIndex - 1];
    if (id) bySegment[id] = row; // rows are in submission order, so later ones win
  });
  const values = Object.values(bySegment);
  if (values.length) {
    latest.getRange(2, 1, values.length, COLUMNS.length).setValues(values);
  }
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(COLUMNS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function isDuplicate(sheet, clientId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const clientIdColIndex = COLUMNS.indexOf("ClientId") + 1;
  const ids = sheet.getRange(2, clientIdColIndex, lastRow - 1, 1).getValues();
  return ids.some((row) => row[0] === clientId);
}

function savePhoto(dataUrl, clientId) {
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.*)$/);
  if (!match) return "";
  const mimeType = match[1];
  const base64 = match[2];
  const bytes = Utilities.base64Decode(base64);
  const ext = mimeType.split("/")[1] || "jpg";
  const blob = Utilities.newBlob(bytes, mimeType, `${clientId}.${ext}`);

  const folder = getOrCreatePhotoFolder();
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function getOrCreatePhotoFolder() {
  const folders = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(PHOTO_FOLDER_NAME);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
