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
  const action = e.parameter && e.parameter.action;
  if (action === "submittedSegments") {
    return jsonResponse(getDistinctSegmentIds());
  }
  return ContentService.createTextOutput(
    "Parknav Survey API is running."
  ).setMimeType(ContentService.MimeType.TEXT);
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

    sheet.appendRow([
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
    ]);

    return jsonResponse({ status: "ok" });
  } catch (err) {
    return jsonResponse({ status: "error", message: String(err) });
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
