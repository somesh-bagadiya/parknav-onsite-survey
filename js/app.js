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
  const SUBMITTED_STYLE = { color: "#1f9d55", weight: 5, opacity: 0.75 };
  const SYNC_INTERVAL_MS = 20000;
  const SUBMITTED_REFRESH_INTERVAL_MS = 45000;

  let map;
  let selectedLayer = null;
  let selectedSegment = null; // { id, name, lat, lng }
  let compressedPhoto = null; // { dataUrl, width, height, approxBytes }
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
    localStorage.setItem(SUBMITTED_KEY, JSON.stringify([...submittedSegmentIds]));
  }

  function styleForSegment(id) {
    return submittedSegmentIds.has(id) ? SUBMITTED_STYLE : DEFAULT_STYLE;
  }

  function markSegmentSubmitted(id) {
    if (submittedSegmentIds.has(id)) return;
    submittedSegmentIds.add(id);
    persistSubmittedSet();
    const layer = layerBySegmentId.get(id);
    if (layer && layer !== selectedLayer) {
      layer.setStyle(SUBMITTED_STYLE);
    }
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

  function selectSegment(seg, layer) {
    if (selectedLayer) {
      selectedLayer.setStyle(styleForSegment(selectedSegment && selectedSegment.id));
    }
    layer.setStyle(SELECTED_STYLE);
    layer.bringToFront();
    selectedLayer = layer;
    const mid = midpointBySegmentId.get(seg.id) || [null, null];
    selectedSegment = { id: seg.id, name: seg.name || "", lat: mid[0], lng: mid[1] };
    openFormSheet();
  }

  function deselectSegment() {
    if (selectedLayer && selectedSegment) {
      selectedLayer.setStyle(styleForSegment(selectedSegment.id));
    }
    selectedLayer = null;
    selectedSegment = null;
  }

  // ---------------------------------------------------------------------
  // Name / ID capture (REQ-012, ASM-005)
  // ---------------------------------------------------------------------

  function ensureSurveyorName() {
    const existing = localStorage.getItem(NAME_KEY);
    if (existing) return;
    const modal = document.getElementById("name-modal");
    modal.hidden = false;
    document.getElementById("name-save-btn").addEventListener("click", () => {
      const val = document.getElementById("name-input").value.trim();
      if (!val) {
        document.getElementById("name-input").focus();
        return;
      }
      localStorage.setItem(NAME_KEY, val);
      modal.hidden = true;
    });
  }

  function getSurveyorName() {
    return localStorage.getItem(NAME_KEY) || "Unknown";
  }

  // ---------------------------------------------------------------------
  // Form sheet (REQ-005 through REQ-011)
  // ---------------------------------------------------------------------

  function openFormSheet() {
    resetForm();
    document.getElementById("form-time-label").textContent =
      "Observed " + new Date().toLocaleString();
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
