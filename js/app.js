/**
 * Parknav Onsite Survey - main app logic.
 * Map (tap-to-select) + form + offline queue + background sync.
 */
(function () {
  "use strict";

  const NAME_KEY = "parknavSurveyorName";
  const SUBMITTED_KEY = "parknavSubmittedSegments";
  const DEFAULT_STYLE = { color: "#0055a2", weight: 5, opacity: 0.55 };
  const SELECTED_STYLE = { color: "#e2662b", weight: 6, opacity: 0.95 };
  const SUBMITTED_STYLE = { color: "#D4AF37", weight: 5, opacity: 0.9 };
  const SYNC_INTERVAL_MS = 20000;
  const SUBMITTED_REFRESH_INTERVAL_MS = 45000;

  let map;
  let selectedLayer = null;
  let selectedSegment = null; // { id, name, lat, lng }
  let compressedPhoto = null; // { dataUrl, width, height, approxBytes }
  let pendingEditPrefill = null; // last-submission row from the preview's "Edit" button
  const layerBySegmentId = new Map();
  const midpointBySegmentId = new Map(); // id -> [lat, lng]
  let submittedSegmentIds = new Set();

  // ---------------------------------------------------------------------
  // Submitted-segment tracking (feature: color already-submitted segments)
  // ---------------------------------------------------------------------

  function loadSubmittedSetFromStorage() {
    try {
      const raw = localStorage.getItem(SUBMITTED_KEY);
      submittedSegmentIds = new Set(raw ? JSON.parse(raw) : []);
    } catch (err) {
      submittedSegmentIds = new Set();
    }
  }

  function persistSubmittedSet() {
    try {
      localStorage.setItem(SUBMITTED_KEY, JSON.stringify([...submittedSegmentIds]));
    } catch (err) {
      // Storage may be full/blocked (e.g. private browsing) - the color
      // change below still happens for this session either way.
      console.warn("Could not persist submitted segments", err);
    }
  }

  function styleForSegment(id) {
    return submittedSegmentIds.has(id) ? SUBMITTED_STYLE : DEFAULT_STYLE;
  }

  // Forces the layer to gold unconditionally, regardless of whether it's
  // currently the "selected" (orange) layer - called right at submit time
  // so the color change doesn't depend on the deselect/close-sheet flow
  // running afterward. deselectSegment() re-applies the same style when the
  // sheet closes, which is a harmless no-op once this has already run.
  function markSegmentSubmitted(id) {
    submittedSegmentIds.add(id);
    const layer = layerBySegmentId.get(id);
    if (layer) {
      layer.setStyle(SUBMITTED_STYLE);
      layer.bringToFront();
    } else {
      console.warn("markSegmentSubmitted: no layer found for id", id);
    }
    persistSubmittedSet();
  }

  // Best-effort: ask the backend which segments already have a submission
  // from ANY surveyor (not just this device), so the team doesn't
  // accidentally re-cover the same street. This relies on Apps Script's
  // GET endpoint being reachable cross-origin; if it isn't (network error,
  // stale deployment, etc.) this silently no-ops and local marks still work.
  async function fetchSubmittedFromServer() {
    if (!navigator.onLine) return;
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf("PASTE_YOUR") === 0) return;
    try {
      const res = await fetch(APPS_SCRIPT_URL + "?action=submittedSegments");
      if (!res.ok) return;
      const ids = await res.json();
      if (!Array.isArray(ids)) return;
      let changed = false;
      ids.forEach((id) => {
        if (!submittedSegmentIds.has(id)) {
          submittedSegmentIds.add(id);
          changed = true;
          const layer = layerBySegmentId.get(id);
          if (layer && layer !== selectedLayer) layer.setStyle(SUBMITTED_STYLE);
        }
      });
      if (changed) persistSubmittedSet();
    } catch (err) {
      // Offline, CORS not available, or backend not redeployed yet - ignore.
    }
  }

  // Powers the "already submitted" preview: how many times this segment has
  // been submitted, and the most recent submission's full details. Returns
  // null (rather than throwing) whenever we can't reach the backend, so
  // callers can fall back to the plain blank-form flow.
  async function fetchSegmentDetails(id) {
    if (!navigator.onLine) return null;
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf("PASTE_YOUR") === 0) return null;
    try {
      const res = await fetch(
        APPS_SCRIPT_URL + "?action=segmentDetails&segmentId=" + encodeURIComponent(id)
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data.count !== "number") return null;
      return data;
    } catch (err) {
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // Map setup
  // ---------------------------------------------------------------------

  async function initMap() {
    const res = await fetch("data/segments.json");
    const data = await res.json();

    map = L.map("map", {
      preferCanvas: true,
      zoomControl: true,
      minZoom: 11,
      maxZoom: 19,
    });

    if (data.bounds) {
      map.fitBounds(data.bounds, { padding: [20, 20] });
    } else {
      map.setView(data.center || [37.3352, -121.8811], 14);
    }

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    data.segments.forEach((seg) => {
      const latlngs = seg.path;
      const mid = latlngs[Math.floor(latlngs.length / 2)];
      midpointBySegmentId.set(seg.id, mid);
      const line = L.polyline(latlngs, {
        ...styleForSegment(seg.id),
        className: "segment-line",
      }).addTo(map);
      line.on("click", () => selectSegment(seg, line));
      layerBySegmentId.set(seg.id, line);
    });

    // Locate the user, if permitted, to help orient the map (does not block).
    map.locate({ setView: false, maxZoom: 17 });
    map.on("locationfound", (e) => {
      L.circleMarker(e.latlng, {
        radius: 6,
        color: "#1f9d55",
        fillColor: "#1f9d55",
        fillOpacity: 0.8,
      }).addTo(map);
    });

    hideHintBannerSoon();
  }

  function hideHintBannerSoon() {
    const banner = document.getElementById("hint-banner");
    setTimeout(() => banner.classList.add("hidden"), 4000);
  }

  async function selectSegment(seg, layer) {
    if (selectedLayer) {
      selectedLayer.setStyle(styleForSegment(selectedSegment && selectedSegment.id));
    }
    layer.setStyle(SELECTED_STYLE);
    layer.bringToFront();
    selectedLayer = layer;
    const mid = midpointBySegmentId.get(seg.id) || [null, null];
    selectedSegment = { id: seg.id, name: seg.name || "", lat: mid[0], lng: mid[1] };

    // Hide whatever sheet is currently open for the PREVIOUS segment right
    // away. Without this, tapping a new segment while a preview/form sheet
    // is still open (the map stays partly visible above it, so this is
    // reachable) left the old sheet's stale content sitting on top of the
    // loading spinner for the whole fetch, instead of the spinner showing.
    document.getElementById("preview-sheet").hidden = true;
    document.getElementById("form-sheet").hidden = true;

    // Already-submitted street: show a preview of what's on file (count +
    // latest details) before jumping into the form, so surveyors don't
    // accidentally duplicate work blind. If we can't reach the backend
    // (offline, etc.) just fall through to the normal blank form. The fetch
    // takes a couple of seconds, so show a loading state instead of leaving
    // the screen looking unresponsive/stale in the meantime.
    if (submittedSegmentIds.has(seg.id)) {
      document.getElementById("loading-sheet").hidden = false;
      const details = await fetchSegmentDetails(seg.id);
      document.getElementById("loading-sheet").hidden = true;
      // Bail if the user tapped away from this segment while the fetch was
      // in flight.
      if (!selectedSegment || selectedSegment.id !== seg.id) return;
      if (details && details.count > 0) {
        openPreviewSheet(details);
        return;
      }
    }
    openFormSheet();
  }

  function deselectSegment() {
    if (selectedLayer && selectedSegment) {
      selectedLayer.setStyle(styleForSegment(selectedSegment.id));
    }
    selectedLayer = null;
    selectedSegment = null;
    pendingEditPrefill = null;
    document.getElementById("loading-sheet").hidden = true;
  }

  // ---------------------------------------------------------------------
  // "Already submitted" preview sheet
  // ---------------------------------------------------------------------

  function openPreviewSheet(details) {
    const latest = details.latest || {};
    pendingEditPrefill = latest;

    document.getElementById("preview-count").textContent =
      `Submitted ${details.count} time${details.count === 1 ? "" : "s"}`;

    const when = latest.SubmittedAtLocal
      ? new Date(latest.SubmittedAtLocal).toLocaleString()
      : "unknown time";
    const extras = [];
    if (latest.TimeLimitHours) extras.push(`Time limit: ${latest.TimeLimitHours}h`);
    if (latest.MeterRate) extras.push(`Meter rate: $${latest.MeterRate}/hr`);

    document.getElementById("preview-summary").innerHTML = `
      <div><strong>${escapeHtml(latest.TotalSpots ?? "—")}</strong> total,
        <strong>${escapeHtml(latest.OccupiedSpots ?? "—")}</strong> occupied
        (${escapeHtml(latest.OccupancyPct ?? "—")}%)</div>
      <div>By ${escapeHtml(latest.SubmitterName || "Unknown")} &middot; ${escapeHtml(when)}</div>
      ${extras.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
    `;

    const photoLink = document.getElementById("preview-photo-link");
    if (latest.PhotoUrl) {
      photoLink.href = latest.PhotoUrl;
      photoLink.hidden = false;
    } else {
      photoLink.hidden = true;
    }

    document.getElementById("form-sheet").hidden = true;
    document.getElementById("preview-sheet").hidden = false;
  }

  function closePreviewSheet() {
    document.getElementById("preview-sheet").hidden = true;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  // ---------------------------------------------------------------------
  // Name / ID capture (REQ-012, ASM-005)
  // ---------------------------------------------------------------------

  // Two people typing "Somesh", "somesh", and "SOMESH" should all be treated
  // as the same surveyor in the Sheet, not three different-looking names.
  // Normalize to a single canonical casing ("Title Case") so name-based
  // filtering/grouping downstream is reliable regardless of how each person
  // happened to type it.
  function normalizeName(raw) {
    return raw
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function ensureSurveyorName() {
    const existing = localStorage.getItem(NAME_KEY);
    if (existing) return;
    const modal = document.getElementById("name-modal");
    modal.hidden = false;
    document.getElementById("name-save-btn").addEventListener("click", () => {
      const val = normalizeName(document.getElementById("name-input").value);
      if (!val) {
        document.getElementById("name-input").focus();
        return;
      }
      localStorage.setItem(NAME_KEY, val);
      modal.hidden = true;
    });
  }

  function getSurveyorName() {
    const stored = localStorage.getItem(NAME_KEY);
    return stored ? normalizeName(stored) : "Unknown";
  }

  // ---------------------------------------------------------------------
  // Form sheet (REQ-005 through REQ-011)
  // ---------------------------------------------------------------------

  // Pass `prefill` (a row object shaped like the segmentDetails "latest"
  // field) to open the form pre-populated with the last submission's
  // values, for the preview sheet's "Edit" button. Submitting still creates
  // a brand new row (see handleSubmit) - this never rewrites history, it
  // just saves the surveyor from retyping everything to fix one field.
  function openFormSheet(prefill) {
    resetForm();
    document.getElementById("form-time-label").textContent =
      "Observed " + new Date().toLocaleString();

    if (prefill) {
      if (prefill.TotalSpots !== "" && prefill.TotalSpots != null) {
        document.getElementById("field-total").value = prefill.TotalSpots;
      }
      if (prefill.OccupiedSpots !== "" && prefill.OccupiedSpots != null) {
        document.getElementById("field-occupied").value = prefill.OccupiedSpots;
      }
      if (prefill.TimeLimitHours !== "" && prefill.TimeLimitHours != null) {
        document.getElementById("field-time-limit").value = prefill.TimeLimitHours;
      }
      if (prefill.MeterRate !== "" && prefill.MeterRate != null) {
        document.getElementById("field-meter-rate").value = prefill.MeterRate;
      }
      updateOccupancyDisplay();
      if (prefill.PhotoUrl) {
        const note = document.getElementById("previous-photo-note");
        note.href = prefill.PhotoUrl;
        note.hidden = false;
      }
    }

    document.getElementById("form-sheet").hidden = false;
    document.getElementById("field-total").focus();
  }

  function closeFormSheet() {
    document.getElementById("form-sheet").hidden = true;
    deselectSegment();
  }

  function resetForm() {
    document.getElementById("survey-form").reset();
    document.getElementById("field-error").hidden = true;
    document.getElementById("photo-preview").hidden = true;
    document.getElementById("previous-photo-note").hidden = true;
    compressedPhoto = null;
    updateOccupancyDisplay();
  }

  function updateOccupancyDisplay() {
    const total = parseFloat(document.getElementById("field-total").value);
    const occupied = parseFloat(document.getElementById("field-occupied").value);
    const fill = document.getElementById("occupancy-fill");
    const label = document.getElementById("occupancy-pct");
    const errorBox = document.getElementById("field-error");

    if (!isNaN(total) && !isNaN(occupied) && occupied > total) {
      errorBox.textContent = "Occupied spots cannot exceed total spots.";
      errorBox.hidden = false;
    } else {
      errorBox.hidden = true;
    }

    if (!isNaN(total) && total > 0 && !isNaN(occupied) && occupied >= 0) {
      const pct = Math.min(100, Math.round((occupied / total) * 1000) / 10);
      fill.style.width = pct + "%";
      fill.style.background =
        pct >= 90 ? "#d64545" : pct >= 60 ? "#e2a03f" : "#1f9d55";
      label.textContent = pct + "%";
    } else {
      fill.style.width = "0%";
      label.textContent = "--%";
    }
  }

  function computeOccupancyPct(total, occupied) {
    if (!total || total <= 0) return null;
    return Math.round((occupied / total) * 1000) / 10;
  }

  async function handlePhotoChange(e) {
    const file = e.target.files[0];
    if (!file) {
      compressedPhoto = null;
      document.getElementById("photo-preview").hidden = true;
      return;
    }
    try {
      compressedPhoto = await PhotoUtil.compressPhoto(file);
      const preview = document.getElementById("photo-preview");
      preview.src = compressedPhoto.dataUrl;
      preview.hidden = false;
    } catch (err) {
      console.error("Photo compression failed", err);
      showToast("Could not process that photo; try another.");
      compressedPhoto = null;
    }
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selectedSegment) {
      showToast("Select a segment on the map first.");
      return;
    }

    const total = parseInt(document.getElementById("field-total").value, 10);
    const occupied = parseInt(document.getElementById("field-occupied").value, 10);

    if (isNaN(total) || isNaN(occupied)) {
      showToast("Total and occupied spots are required.");
      return;
    }
    if (occupied > total) {
      showToast("Occupied spots cannot exceed total spots.");
      return;
    }

    const timeLimitRaw = document.getElementById("field-time-limit").value;
    const meterRateRaw = document.getElementById("field-meter-rate").value;

    const payload = {
      clientId: uuid(),
      submittedAtLocal: new Date().toISOString(),
      submitterName: getSurveyorName(),
      segmentId: selectedSegment.id,
      segmentName: selectedSegment.name,
      segmentLat: selectedSegment.lat,
      segmentLng: selectedSegment.lng,
      totalSpots: total,
      occupiedSpots: occupied,
      occupancyPct: computeOccupancyPct(total, occupied),
      timeLimitHours: timeLimitRaw ? parseFloat(timeLimitRaw) : null,
      meterRate: meterRateRaw ? parseFloat(meterRateRaw) : null,
      photoDataUrl: compressedPhoto ? compressedPhoto.dataUrl : null,
    };

    await SurveyQueue.add(payload);
    await refreshSyncBadge();
    markSegmentSubmitted(selectedSegment.id);
    showToast("Saved. Will sync automatically.");
    closeFormSheet();
    trySync();
  }

  // ---------------------------------------------------------------------
  // Offline queue + background sync (REQ-015, TASK-008)
  // ---------------------------------------------------------------------

  let syncing = false;

  async function trySync() {
    if (syncing) return;
    if (!navigator.onLine) return;
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf("PASTE_YOUR") === 0) return;

    syncing = true;
    setSyncBadgeSyncing(true);
    try {
      const items = await SurveyQueue.getAll();
      for (const item of items) {
        try {
          // Apps Script Web Apps don't return CORS headers, so we send in
          // no-cors mode. A resolved fetch (even opaque) means the request
          // reached the network; a thrown error means we're still offline.
          // See apps-script/DEPLOY.md for the known limitation this implies.
          await fetch(APPS_SCRIPT_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(item),
          });
          await SurveyQueue.remove(item.localId);
        } catch (err) {
          // Network error - stop here, we're probably offline again.
          break;
        }
      }
    } finally {
      syncing = false;
      setSyncBadgeSyncing(false);
      await refreshSyncBadge();
    }
  }

  async function refreshSyncBadge() {
    const n = await SurveyQueue.count();
    const badge = document.getElementById("sync-badge");
    document.getElementById("sync-label").textContent =
      n > 0 ? `${n} pending` : "All synced";
    badge.classList.toggle("has-pending", n > 0);
  }

  function setSyncBadgeSyncing(isSyncing) {
    document.getElementById("sync-badge").classList.toggle("syncing", isSyncing);
  }

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------

  let toastTimer = null;
  function showToast(msg) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 2600);
  }

  // ---------------------------------------------------------------------
  // Wire-up
  // ---------------------------------------------------------------------

  function init() {
    ensureSurveyorName();
    loadSubmittedSetFromStorage();
    initMap().then(fetchSubmittedFromServer);

    document.getElementById("form-close-btn").addEventListener("click", closeFormSheet);
    document.getElementById("survey-form").addEventListener("submit", handleSubmit);
    document.getElementById("field-total").addEventListener("input", updateOccupancyDisplay);
    document.getElementById("field-occupied").addEventListener("input", updateOccupancyDisplay);
    document.getElementById("field-photo").addEventListener("change", handlePhotoChange);

    document.getElementById("preview-close-btn").addEventListener("click", () => {
      closePreviewSheet();
      deselectSegment();
    });
    document.getElementById("preview-add-new-btn").addEventListener("click", () => {
      closePreviewSheet();
      openFormSheet();
    });
    document.getElementById("preview-edit-btn").addEventListener("click", () => {
      closePreviewSheet();
      openFormSheet(pendingEditPrefill);
    });

    window.addEventListener("online", () => {
      trySync();
      fetchSubmittedFromServer();
    });
    setInterval(trySync, SYNC_INTERVAL_MS);
    setInterval(fetchSubmittedFromServer, SUBMITTED_REFRESH_INTERVAL_MS);
    refreshSyncBadge();
    trySync();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch((err) => {
        console.warn("Service worker registration failed", err);
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
