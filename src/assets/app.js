// Spoon tracker front-end. Reads the collection from the Cloudflare Worker, caching
// the last result so the app opens offline for VIEWING and SEARCH (adding needs a
// connection). The write token is held only in this session — Apple Passwords is the
// durable, synced home for it.

const root = document.getElementById("app");
const API = root.dataset.api;
const DEMO = new URLSearchParams(location.search).has("demo");
const $ = (id) => document.getElementById(id);

let SPOONS = [];
let source = "live"; // live | sample | offline-cache | offline-sample
let view = "dots"; // dots | country
let countryFilter = null;
let search = "";
let token = sessionStorage.getItem("spoon_token") || "";

let map, markerLayer;

/* --------------------------------------------------------------- helpers */
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mean = (arr) => { const v = arr.filter((x) => typeof x === "number"); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const countryKey = (s) => s.countryName || s.country || "—";
function groupByCountry(list) {
  const m = new Map();
  for (const s of list) { const k = countryKey(s); if (!m.has(k)) m.set(k, []); m.get(k).push(s); }
  return m;
}

/* ------------------------------------------------------------------ data */
async function fetchLive() {
  const r = await fetch(API + "/spoons", { cache: "no-store" });
  if (!r.ok) throw new Error("http " + r.status);
  return r.json();
}
async function fetchSample() {
  try { const r = await fetch("assets/spoons.sample.json"); return await r.json(); } catch { return []; }
}
function readCache() {
  try { return JSON.parse(localStorage.getItem("spoon_cache") || "null"); } catch { return null; }
}
async function load() {
  if (DEMO) { SPOONS = await fetchSample(); source = "sample"; return render(); }
  try {
    SPOONS = await fetchLive();
    source = "live";
    try { localStorage.setItem("spoon_cache", JSON.stringify(SPOONS)); } catch {}
  } catch {
    const cached = readCache();
    if (cached && cached.length) { SPOONS = cached; source = "offline"; }
    else { SPOONS = []; source = "error"; }
  }
  render();
}

/* ------------------------------------------------------------------- map */
function initMap() {
  const el = $("map");
  map = L.map(el, { scrollWheelZoom: true });
  map.createPane("basemap");
  map.getPane("basemap").style.zIndex = 150;
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  map.setView([50, 15], 4);
  addBasemap(el.dataset.basemap);
  render();
}
async function addBasemap(url) {
  try {
    const gj = await (await fetch(url)).json();
    L.geoJSON(gj, {
      pane: "basemap", interactive: false,
      style: { color: "#6fb9a8", weight: 1, fillColor: "#26413c", fillOpacity: 1 }
    }).addTo(map);
  } catch { /* sea-coloured background remains */ }
}
const countIcon = (n) => L.divIcon({ className: "", html: `<div class="countpin">${n}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
function popupHtml(s) {
  let h = `<strong>${esc(s.name || "")}</strong>`;
  const meta = [s.city, s.countryName].filter(Boolean).join(", ");
  if (meta) h += `<br>${esc(meta)}`;
  if (s.note) h += `<br><em>${esc(s.note)}</em>`;
  return h;
}

/* ---------------------------------------------------------------- filter */
function visible() {
  let list = SPOONS.slice();
  if (countryFilter) list = list.filter((s) => countryKey(s) === countryFilter);
  if (search) {
    const q = search.toLowerCase();
    list = list.filter((s) => [s.name, s.city, s.country, s.countryName]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }
  return list;
}

/* ---------------------------------------------------------------- render */
function render() {
  const list = visible();
  $("total").textContent = totalText();
  renderBanner();
  renderCountries();
  renderList(list);
  renderMap(list);
}
function totalText() {
  const n = SPOONS.length;
  const c = new Set(SPOONS.map(countryKey).filter((k) => k !== "—")).size;
  return `${n} spoon${n === 1 ? "" : "s"} · ${c} countr${c === 1 ? "y" : "ies"}`;
}
let bannerTimer;
function renderBanner() {
  const b = $("banner"); const bits = [];
  if (source === "sample") bits.push("Showing sample data (demo mode).");
  else if (source === "offline") bits.push("Offline — showing your last-synced spoons (viewing only).");
  else if (source === "error") bits.push("Couldn't reach the server — check your connection.");
  if (countryFilter) bits.push("Filtered: " + countryFilter);
  if (!bits.length) { b.hidden = true; b.textContent = ""; return; }
  b.hidden = false; b.textContent = bits.join("  ·  ");
  if (countryFilter) {
    const a = document.createElement("button");
    a.className = "linkbtn"; a.textContent = "show all";
    a.onclick = () => { countryFilter = null; render(); };
    b.append("  "); b.appendChild(a);
  }
}
function showBanner(msg) {
  const b = $("banner"); b.hidden = false; b.textContent = msg;
  clearTimeout(bannerTimer); bannerTimer = setTimeout(renderBanner, 3000);
}
function renderCountries() {
  const el = $("countries");
  if (view !== "country") { el.hidden = true; return; }
  el.hidden = false; el.innerHTML = "";
  const groups = [...groupByCountry(SPOONS).entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [key, arr] of groups) {
    const chip = document.createElement("button");
    chip.className = "chip" + (countryFilter === key ? " is-on" : "");
    chip.innerHTML = `<span>${esc(key)}</span><b>${arr.length}</b>`;
    chip.onclick = () => { countryFilter = key; view = "dots"; syncToggle(); render(); };
    el.appendChild(chip);
  }
  if (!groups.length) el.innerHTML = "<p class='muted'>No spoons yet.</p>";
}
function renderList(list) {
  const el = $("list"); el.innerHTML = "";
  if (!list.length) {
    const li = document.createElement("li"); li.className = "empty";
    li.textContent = source === "live" && !SPOONS.length ? "No spoons yet — unlock writing and add your first." : "No matches.";
    el.appendChild(li); return;
  }
  for (const s of list) {
    const li = document.createElement("li"); li.className = "card";
    const main = document.createElement("div"); main.className = "card__main";
    main.innerHTML =
      `<div class="card__name">${esc(s.name || "(unnamed)")} <span class="card__cc">${esc(s.country || "")}</span></div>` +
      `<div class="card__meta">${esc([s.city, s.countryName].filter(Boolean).join(", "))}</div>` +
      (s.note ? `<div class="card__note">${esc(s.note)}</div>` : "");
    li.appendChild(main);
    if (token) {
      const actions = document.createElement("div"); actions.className = "card__actions";
      const e = document.createElement("button"); e.className = "btn btn--sm"; e.textContent = "Edit"; e.onclick = () => editSpoon(s.id);
      const x = document.createElement("button"); x.className = "btn btn--sm btn--danger"; x.textContent = "Delete"; x.onclick = () => expunge(s.id);
      actions.append(e, x); li.appendChild(actions);
    }
    el.appendChild(li);
  }
}
function renderMap(list) {
  if (!map) return;
  markerLayer.clearLayers();
  const pts = [];
  if (view === "country") {
    for (const [key, arr] of groupByCountry(list)) {
      const lat = mean(arr.map((s) => s.lat)); const lng = mean(arr.map((s) => s.lng));
      if (lat == null || lng == null) continue;
      const m = L.marker([lat, lng], { icon: countIcon(arr.length) });
      m.on("click", () => { countryFilter = key; view = "dots"; syncToggle(); render(); });
      m.bindPopup(`<strong>${esc(key)}</strong><br>${arr.length} spoon${arr.length > 1 ? "s" : ""}`);
      markerLayer.addLayer(m); pts.push([lat, lng]);
    }
  } else {
    for (const s of list) {
      if (s.lat == null || s.lng == null) continue;
      const m = L.circleMarker([s.lat, s.lng], { radius: 7, color: "#141118", weight: 2, fillColor: "#e0b24a", fillOpacity: 1 });
      m.bindPopup(popupHtml(s));
      markerLayer.addLayer(m); pts.push([s.lat, s.lng]);
    }
  }
  if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: view === "country" ? 7 : 12 });
}

/* --------------------------------------------------------------- add flow */
let geoTimer, chosen = null;
async function geocode(q) {
  try {
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=" + encodeURIComponent(q);
    const results = await (await fetch(url, { headers: { "Accept-Language": "en" } })).json();
    const ul = $("place-results"); ul.innerHTML = "";
    if (!results.length) { ul.innerHTML = "<li class='muted'>No matches.</li>"; return; }
    for (const r of results) {
      const li = document.createElement("li");
      li.textContent = r.display_name;
      li.onclick = () => choose(r);
      ul.appendChild(li);
    }
  } catch {
    $("place-results").innerHTML = "<li class='muted'>Place search needs internet.</li>";
  }
}
function choose(r) {
  const a = r.address || {};
  chosen = {
    name: a.city || a.town || a.village || a.municipality || a.county || String(r.display_name || "").split(",")[0],
    city: a.city || a.town || a.village || "",
    country: String(a.country_code || "").toUpperCase(),
    countryName: a.country || "",
    lat: parseFloat(r.lat), lng: parseFloat(r.lon)
  };
  $("chosen-label").textContent = `${chosen.name} — ${chosen.countryName || chosen.country}`;
  $("chosen").hidden = false;
  $("place-results").innerHTML = "";
  $("place-q").value = chosen.name;
}
async function saveSpoon() {
  if (!chosen) return;
  if (!token) { showBanner("Unlock writing first (🔒 button)."); openToken(); return; }
  const body = { ...chosen, note: $("spoon-note").value.trim() };
  try {
    const r = await fetch(API + "/spoons", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify(body)
    });
    if (r.status === 401) { showBanner("Token rejected — check your write token."); return; }
    if (!r.ok) { showBanner("Save failed (" + r.status + ")."); return; }
    closeAdd(); await load(); showBanner("Spoon saved.");
  } catch { showBanner("Save failed — no connection."); }
}
function closeAdd() {
  $("add-form").hidden = true; $("chosen").hidden = true;
  $("place-q").value = ""; $("spoon-note").value = ""; $("place-results").innerHTML = ""; chosen = null;
}

/* ---------------------------------------------------------- edit / expunge */
async function expunge(id) {
  if (!token) return showBanner("Unlock writing first.");
  if (!confirm("Delete this spoon?")) return;
  try {
    const r = await fetch(API + "/spoons/" + id, { method: "DELETE", headers: { "Authorization": "Bearer " + token } });
    if (r.ok) { await load(); showBanner("Expunged."); } else showBanner("Delete failed (" + r.status + ").");
  } catch { showBanner("Delete failed — no connection."); }
}
async function editSpoon(id) {
  if (!token) return showBanner("Unlock writing first.");
  const s = SPOONS.find((x) => x.id === id); if (!s) return;
  const note = prompt("Note:", s.note || ""); if (note === null) return;
  const countryName = prompt("Country:", s.countryName || s.country || ""); if (countryName === null) return;
  try {
    const r = await fetch(API + "/spoons/" + id, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify({ note, countryName })
    });
    if (r.ok) { await load(); showBanner("Updated."); } else showBanner("Edit failed (" + r.status + ").");
  } catch { showBanner("Edit failed — no connection."); }
}

/* ------------------------------------------------------------------- lock */
function openToken() { $("token-form").hidden = false; $("token-input").focus(); }
function updateLockUI() { $("unlock-btn").textContent = token ? "🔓 Writing unlocked" : "🔒 Unlock writing"; }

/* ------------------------------------------------------------------- wire */
function syncToggle() {
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("is-on", b.dataset.view === view));
}
function wireUI() {
  $("unlock-btn").onclick = openToken;
  $("token-cancel").onclick = () => { $("token-form").hidden = true; };
  $("token-form").onsubmit = (e) => {
    e.preventDefault();
    token = $("token-input").value.trim();
    sessionStorage.setItem("spoon_token", token);
    $("token-form").hidden = true;
    updateLockUI(); render();
    showBanner(token ? "Writing unlocked." : "Token cleared.");
  };
  $("add-btn").disabled = false;
  $("add-btn").onclick = () => { $("add-form").hidden = !$("add-form").hidden; if (!$("add-form").hidden) $("place-q").focus(); };
  $("add-cancel").onclick = closeAdd;
  $("save-btn").onclick = saveSpoon;
  $("place-q").oninput = (e) => {
    clearTimeout(geoTimer); const q = e.target.value.trim();
    if (q.length < 3) { $("place-results").innerHTML = ""; return; }
    geoTimer = setTimeout(() => geocode(q), 500);
  };
  $("search").oninput = (e) => { search = e.target.value.trim(); render(); };
  document.querySelectorAll("[data-view]").forEach((b) =>
    b.onclick = () => { view = b.dataset.view; countryFilter = null; syncToggle(); render(); });
}

/* ------------------------------------------------------------------- boot */
wireUI();
updateLockUI();
if (window.L) initMap();
else window.addEventListener("load", () => { if (window.L) initMap(); });
load();
