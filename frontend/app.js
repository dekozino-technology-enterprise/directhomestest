const API = window.API_URL || "", app = document.getElementById("app");
let activeRouteVersion = 0;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const user = () => { try { return JSON.parse(localStorage.getItem("u")); } catch { return null; } };
const arr = (d) => Array.isArray(d) ? d : d && typeof d === "object" ? [d.items, d.results, d.tokens, d.tenancies, d.tickets, d.properties, d.units, d.viewings].find(Array.isArray) || [] : [];
const naira = (n) => "₦" + Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 });
const humanize = (s) => String(s ?? "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const mediaUrl = (raw) => {
  const path = typeof raw === "string" ? raw : raw?.url || "";
  return !path ? "" : /^(https?:|data:|blob:)/i.test(path) ? path : API + path;
};
const img = (u = {}) => {
  const raw = u.image || u.photo || u.cover || (u.images && u.images[0]) || u.thumbnail;
  const src = mediaUrl(raw);
  return src ? `<img class="listing-image" loading="lazy" decoding="async" src="${esc(src)}" alt="${esc(u.title || "Home listing")}">` : `<div class="photo-placeholder" aria-label="No property photo"><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="m7 22 17-14 17 14v17a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V22Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M19 41V26h10v15M4 22 24 5l20 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
};
const prices = (u = {}) => Object.entries(u).filter(([k, v]) => /rent|total|caution|service/i.test(k) && typeof v === "number").map(([k, v]) => `<span class="price-line"><span>${esc(humanize(k))}</span><b>${naira(/Kobo$/i.test(k) ? v / 100 : v)}</b></span>`).join("");
const kv = (o = {}) => Object.entries(o || {}).filter(([k, v]) => v !== null && typeof v !== "object" && !/^id$|Id$|password/i.test(k)).map(([k, v]) => `<div class="kv-row"><span>${esc(humanize(k))}</span><b>${esc(typeof v === "boolean" ? (v ? "Yes" : "No") : v)}</b></div>`).join("");
const say = (m) => { const t = document.getElementById("toast"); if (!t) return; t.textContent = m; t.style.display = "block"; clearTimeout(window.__toastTimer); window.__toastTimer = setTimeout(() => (t.style.display = "none"), 3800); };
const logout = () => { localStorage.clear(); location.hash = "#/login"; nav(); };

async function api(p, o = {}) {
  const go = () => fetch(API + "/api/" + p, { method: o.method || (o.body || o.form ? "POST" : "GET"), headers: { ...(o.form ? {} : { "Content-Type": "application/json" }), ...(localStorage.at ? { Authorization: "Bearer " + localStorage.at } : {}) }, body: o.form || (o.body ? JSON.stringify(o.body) : undefined) });
  let r;
  try { r = await go(); } catch { throw new Error("Could not reach Direct Homes. Check your connection and try again."); }
  if (r.status === 401 && localStorage.rt) {
    let rr;
    try { rr = await fetch(API + "/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: localStorage.rt }) }); }
    catch { logout(); throw new Error("Your session could not be refreshed. Please sign in again."); }
    if (rr.ok) {
      localStorage.at = (await rr.json()).accessToken;
      try { r = await go(); } catch { throw new Error("Could not reach Direct Homes. Check your connection and try again."); }
    } else { logout(); throw new Error("Your session has expired. Please sign in again."); }
  }
  const d = await r.json().catch(() => null);
  if (!r.ok) {
    const fields = d?.fieldErrors || d?.errors?.fieldErrors;
    const fieldMessage = fields ? Object.entries(fields).map(([key, messages]) => `${humanize(key)}: ${Array.isArray(messages) ? messages.join(", ") : messages}`).join("; ") : "";
    const formMessage = d?.errors?.formErrors?.join("; ") || d?.formErrors?.join("; ") || "";
    const fallback = r.status === 404 ? "This API route was not found. Please confirm the frontend API proxy is configured." : r.status >= 500 ? `The server could not complete this request (${r.status}). Please try again shortly.` : `Please check the information and try again (${r.status}).`;
    throw new Error(d?.error || fieldMessage || formMessage || fallback);
  }
  return d;
}

const section = (t, items = [], fn = () => "") => `<section class="dashboard-section"><div class="section-title"><h2>${esc(t)}</h2><span class="section-count">${items.length}</span></div>${items.length ? `<div class="grid">${items.map(fn).join("")}</div>` : `<div class="empty-state">Nothing here yet. Updates will appear here when available.</div>`}</section>`;
const btn = (a, id, label, cls = "", x = "") => `<button class="${cls}" data-a="${a}" data-id="${esc(id)}" data-x="${esc(x)}">${label}</button>`;

// ---------- pages ----------
async function search() {
  const pageVersion = activeRouteVersion;
  const f = new URLSearchParams(location.hash.split("?")[1] || "");
  app.innerHTML = `<section class="search-page">
    <div class="search-toolbar"><div><p class="eyebrow"><span class="eyebrow-dot"></span> A better way to rent</p><h1>Find a place to call home.</h1><p>Browse homes listed directly by owners. No agents, no viewing fees.</p></div><span class="search-trust">✓ Owner-direct listings</span></div>
    <form id="sf" class="filter-panel"><div class="filter-grid">
      <label for="search-q">Area, city or keyword<input id="search-q" name="q" placeholder="e.g. Lekki, Abuja, Wuse" value="${esc(f.get("q") || "")}"></label>
      <label for="search-min">Minimum rent<input id="search-min" name="minRent" type="number" min="0" placeholder="Any" value="${esc(f.get("minRent") || "")}"></label>
      <label for="search-max">Maximum rent<input id="search-max" name="maxRent" type="number" min="0" placeholder="Any" value="${esc(f.get("maxRent") || "")}"></label>
      <label for="search-beds">Bedrooms<input id="search-beds" name="bedrooms" type="number" min="0" placeholder="Any" value="${esc(f.get("bedrooms") || "")}"></label>
      <button type="submit">Search homes <span aria-hidden="true">→</span></button>
    </div></form>
    <div class="results-meta"><h2>Homes for you</h2><span id="result-count">Loading available listings…</span></div>
    <div id="res" class="listing-grid"><div class="loading-panel"><span class="skeleton wide"></span><span class="skeleton medium"></span><span class="skeleton short"></span></div></div>
  </section>`;
  document.getElementById("sf").onsubmit = (e) => {
    e.preventDefault();
    const params = new URLSearchParams([...new FormData(e.target)].filter(([, v]) => String(v).trim()));
    location.hash = "#/search" + (params.toString() ? "?" + params : "");
  };
  const rows = arr(await api("public/units?" + f));
  // Do not let a late search response update a page the user has already left.
  if (pageVersion !== activeRouteVersion) return;
  const result = document.getElementById("res"), count = document.getElementById("result-count");
  if (!result?.isConnected || !count?.isConnected) return;
  if (!rows.length) {
    count.textContent = "No listings found";
    result.innerHTML = `<div class="empty-state"><strong>No homes match those filters just yet.</strong><br>Try a nearby area or remove a filter to see more listings.</div>`;
    return;
  }
  count.textContent = `${rows.length} verified ${rows.length === 1 ? "home" : "homes"}`;
  result.innerHTML = rows.map((u) => {
    const locationName = u.location?.name || u.locationName || u.area || u.address || "Nigeria";
    const rent = u.rentNaira ?? u.rent ?? (u.rentKobo != null ? Number(u.rentKobo) / 100 : null);
    const facts = [[u.bedrooms, "bedrooms"], [u.bathrooms, "bathrooms"]].filter(([v]) => v !== null && v !== undefined).map(([v, label]) => `<span>${esc(v)} ${label}</span>`).join("");
    const price = rent !== null ? `<div class="listing-price"><strong>${naira(rent)}</strong><span>per ${esc(String(u.payDuration || "year").toLowerCase())}</span></div>` : `<div class="listing-price">${prices(u) || `<span>Contact owner for rent</span>`}</div>`;
    return `<a class="listing-card" href="#/unit/${esc(u.id)}" aria-label="View ${esc(u.title || "home listing")}">
      <div class="listing-photo">${img(u)}<span class="listing-verified">✓ Owner listed</span></div>
      <div class="listing-body"><h3>${esc(u.title || "Home for rent")}</h3><div class="listing-location"><span aria-hidden="true">⌖</span>${esc(locationName)}</div>${facts ? `<div class="listing-facts">${facts}</div>` : ""}${price}</div>
    </a>`;
  }).join("");
}
async function unit(id) {
  const pageVersion = activeRouteVersion;
  const u = await api("public/units/" + id);
  if (pageVersion !== activeRouteVersion) return;
  const photos = (u.images || []).map((raw, i) => {
    const src = mediaUrl(raw);
    return src ? `<img src="${esc(src)}" alt="${esc(u.title || "Home")}${i ? ` — photo ${i + 1}` : ""}" loading="lazy">` : "";
  }).filter(Boolean).join("");
  const rent = u.rentNaira ?? u.rent ?? (u.rentKobo != null ? Number(u.rentKobo) / 100 : null);
  const locationName = u.location?.name || u.locationName || u.area || u.address || "Nigeria";
  const facts = [[u.bedrooms, "bedrooms"], [u.bathrooms, "bathrooms"], [u.toilets, "toilets"]].filter(([v]) => v !== null && v !== undefined).map(([v, label]) => `<span class="tag">${esc(v)} ${label}</span>`).join("");
  app.innerHTML = `<section class="detail-page">
    <a class="back-link" href="#/search">← Back to homes</a>
    <div class="detail-layout">
      <div class="detail-main">
        <div class="detail-gallery">${photos || `<div class="photo-placeholder"><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="m7 22 17-14 17 14v17a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V22Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M19 41V26h10v15M4 22 24 5l20 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`}</div>
        <div class="detail-summary"><p class="eyebrow"><span class="eyebrow-dot"></span> Owner-direct home</p><h1>${esc(u.title || "Home for rent")}</h1><p class="listing-location"><span aria-hidden="true">⌖</span>${esc(locationName)}</p>${facts ? `<div class="row">${facts}</div>` : ""}<p>${esc(u.description || "Connect directly with the owner to learn more about this home.")}</p>${prices(u)}${(u.features || []).length ? `<h3>Home features</h3><div class="row">${u.features.map((f) => `<span class="tag">${esc(f.name || f.feature?.name || f)}</span>`).join("")}</div>` : ""}</div>
        <div class="detail-card"><h3>Rent directly. Move with confidence.</h3><p class="muted">Ask the owner a question, arrange a free viewing, or request a payment token when you are ready. Never pay outside the approved payment details in your token.</p></div>
      </div>
      <aside class="detail-sidebar"><p class="eyebrow">Rent direct from the owner</p>${rent !== null ? `<h2>${naira(rent)}</h2><p class="muted">per ${esc(String(u.payDuration || "year").toLowerCase())}</p>` : `<h2>Ask about rent</h2>`}<div class="kv-grid">${kv(Object.fromEntries(Object.entries(u).filter(([k]) => /caution|service|rent/i.test(k))))}</div><div class="row">${btn("enquire", id, "Message the owner")}${btn("viewing", id, "Book a free viewing", "g")}${btn("fav", id, "Save this home", "g")}${btn("token", id, "Request payment token")}${btn("report", id, "Report this listing", "button-quiet")}</div><p class="muted">No viewing fee. Your rent goes directly to the owner.</p></aside>
    </div>
  </section>`;
}
function authForm(reg) {
  app.innerHTML = `<section class="auth-layout">
    <div class="auth-aside"><p class="eyebrow">Direct Homes · Nigeria</p><h2>${reg ? "A better way to find your place." : "Welcome back home."}</h2><p>Connect with verified owners and make your next move with clarity and confidence.</p></div>
    <div class="auth-panel"><p class="eyebrow"><span class="eyebrow-dot"></span> ${reg ? "Join the community" : "Your account"}</p><h1>${reg ? "Create your account" : "Sign in"}</h1><p>${reg ? "Get started with a free Direct Homes account." : "Sign in to manage your home, messages and requests."}</p>
      <form id="af" class="auth-form">
        ${reg ? `<label for="auth-role">I am a<select id="auth-role" name="role"><option value="TENANT">Tenant looking for a home</option><option value="OWNER">Property owner</option><option value="MANAGER">Property manager</option></select></label><label for="auth-name">Full name<input id="auth-name" name="fullName" autocomplete="name" placeholder="Your full name" required></label><label for="auth-phone">Phone number<input id="auth-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="e.g. 08012345678" pattern="(\\+234|0)[789][01][0-9]{8}" title="Use a Nigerian mobile number, e.g. 08012345678 or +2348012345678" required><span class="form-note">Use a Nigerian mobile number, such as 08012345678 or +2348012345678. SMS verification is temporarily paused, so no code is required.</span></label>` : ""}
        <label for="auth-email">Email address<input id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required></label>
        <label for="auth-password">Password<input id="auth-password" name="password" type="password" autocomplete="${reg ? "new-password" : "current-password"}" placeholder="${reg ? "At least 8 characters" : "Your password"}" minlength="8" required></label>
        <button type="submit">${reg ? "Create account" : "Sign in securely"}<span aria-hidden="true">→</span></button>
      </form>
      <p class="auth-switch">${reg ? `Already have an account? <a href="#/login">Sign in</a>` : `New to Direct Homes? <a href="#/register">Create an account</a>`}</p>
      <div class="auth-assurance"><span aria-hidden="true">✓</span> Your account details are handled securely.</div>
    </div>
  </section>`;
  document.getElementById("af").onsubmit = async (e) => {
    e.preventDefault();
    const submit = e.target.querySelector("button[type=submit]");
    if (submit) { submit.disabled = true; submit.dataset.label = submit.textContent; submit.textContent = reg ? "Creating account…" : "Signing in…"; }
    try {
      const d = await api("auth/" + (reg ? "register" : "login"), { body: Object.fromEntries(new FormData(e.target)) });
      localStorage.at = d.accessToken; localStorage.rt = d.refreshToken; localStorage.u = JSON.stringify(d.user);
      nav(); location.hash = "#/dash";
    } catch (x) { say(x.message); }
    finally { if (submit) { submit.disabled = false; submit.textContent = submit.dataset.label; } }
  };
}
async function dash() {
  const pageVersion = activeRouteVersion;
  const u = user(); if (!u) return (location.hash = "#/login");
  if (u.role === "ADMIN") return (location.hash = "#/a/overview");
  const staff = u.role !== "TENANT";
  const get = async (p) => { try { return arr(await api(p)); } catch { return []; } };
  let d, tok, ten, tk, vw, inc, props, units;
  if (!staff) [d, tok, ten, tk, vw] = await Promise.all([api("dashboard/tenant"), get("tokens/mine"), get("tenancies/mine"), get("tickets/mine"), get("viewings/mine")]);
  else [d, inc, tk, props, units, vw] = await Promise.all([api("dashboard/staff"), get("tokens/incoming"), get("tickets/staff"), get("properties/mine"), get("units/mine"), get("viewings/mine")]);
  if (pageVersion !== activeRouteVersion) return;
  const firstName = String(u.fullName || "there").trim().split(/\s+/)[0];
  const roleKey = ["TENANT", "OWNER", "MANAGER"].includes(u.role) ? u.role : "TENANT";
  const roleView = {
    TENANT: { eyebrow: "Resident workspace", title: `Welcome home, ${esc(firstName)}.`, body: "Your viewings, tenancy details, payment tokens and maintenance—all in one calm place.", primary: ["Explore homes", "#/search"], secondary: ["My maintenance", "#/tickets"] },
    OWNER: { eyebrow: "Owner portfolio", title: `Your properties, ${esc(firstName)}.`, body: "Keep listings, rent requests, tenant care and important property work moving with confidence.", primary: ["Add a property", "#/pnew"], secondary: ["Complete verification", "#/onboard"] },
    MANAGER: { eyebrow: "Management workspace", title: `A smoother day starts here, ${esc(firstName)}.`, body: "Coordinate units, payment requests, viewings and tenant care from one shared workspace.", primary: ["Add or update a unit", "#/unitnew"], secondary: ["Review maintenance", "#/tickets"] },
  }[roleKey];
  const heroCount = roleKey === "TENANT" ? ten.length : roleKey === "OWNER" ? props.length : units.length;
  const heroCountLabel = roleKey === "TENANT" ? "Tenancy records" : roleKey === "OWNER" ? "Properties in your portfolio" : "Units in your workspace";
  const statIcon = (k) => /owner|manager|tenant|user/i.test(k) ? "users" : /property|unit|home/i.test(k) ? "properties" : /kyc|verif/i.test(k) ? "kyc" : /ticket|maintenance/i.test(k) ? "tickets" : /payment|token|account/i.test(k) ? "accounts" : "overview";
  const stats = Object.entries(d || {}).filter(([, v]) => typeof v === "number").map(([k, v], i) => `<article class="stat-card stat-tone-${i % 5}"><div class="stat-card-top"><span class="stat-card-icon">${navIcon(statIcon(k))}</span><span class="stat-card-overline">LIVE</span></div><strong>${esc(v)}</strong><span class="stat-card-label">${esc(humanize(k))}</span></article>`).join("");
  let h = `<section class="workspace-hero workspace-hero-${roleKey.toLowerCase()}"><div class="workspace-hero-copy"><p class="workspace-eyebrow"><span class="workspace-live-dot"></span>${esc(roleView.eyebrow)}</p><h1>${roleView.title}</h1><p class="workspace-hero-description">${roleView.body}</p><div class="workspace-hero-actions"><a class="workspace-primary-action" href="${roleView.primary[1]}">${esc(roleView.primary[0])}<span aria-hidden="true">→</span></a><a class="workspace-secondary-action" href="${roleView.secondary[1]}">${esc(roleView.secondary[0])}</a></div></div><div class="workspace-hero-aside"><div class="workspace-brand-orbit" aria-hidden="true"><span class="workspace-orbit-ring workspace-orbit-ring-one"></span><span class="workspace-orbit-ring workspace-orbit-ring-two"></span><span class="workspace-logo-tile"><img src="assets/direct-homes-logo-mark.webp" width="512" height="512" alt=""></span><span class="workspace-orbit-star">✦</span></div><div class="workspace-highlight"><span>${esc(humanize(roleKey))} overview</span><strong>${esc(heroCount)}</strong><small>${esc(heroCountLabel)}</small></div></div></section><div class="overview-metrics-heading"><div><p class="eyebrow"><span class="eyebrow-dot"></span> At a glance</p><h2>Your workspace overview</h2></div><span class="overview-update"><span></span> Up to date</span></div><div class="stats-grid workspace-stats">${stats || `<div class="empty-state">Your account summary will appear here.</div>`}</div>`;
  const quickActions = roleKey === "OWNER" ? [
    ["Add a property", "#/pnew", "Start a new property listing", "+"],
    ["Add a unit", "#/unitnew", "Create a rental unit", "⌂"],
    ["Get verified", "#/onboard", "Identity and receiving details", "✓"],
    ["Maintenance", "#/tickets", "Review tenant requests", "⌁"],
    ["Send a notice", "#/announce", "Share an update with tenants", "↗"],
  ] : roleKey === "MANAGER" ? [
    ["Add or update a unit", "#/unitnew", "Keep your property details current", "+"],
    ["Maintenance", "#/tickets", "Review and update tenant requests", "⌁"],
    ["Send a notice", "#/announce", "Share a clear update with tenants", "↗"],
    ["Get verified", "#/onboard", "Identity and receiving details", "✓"],
  ] : [
    ["Find a home", "#/search", "Browse and contact owners", "⌕"],
    ["Raise a ticket", "#/ticket/new", "Report a maintenance issue", "+"],
    ["My tickets", "#/tickets", "Track repairs and updates", "⌁"],
    ["Notices", "#/news", "Read property updates", "↗"],
  ];
  h += `<section class="quick-actions quick-actions-${roleKey.toLowerCase()}" aria-label="Quick actions"><div class="quick-actions-heading"><div><p class="eyebrow"><span class="eyebrow-dot"></span> Your next steps</p><h2>Make progress, beautifully.</h2><p>Frequent tasks are ready when you need them.</p></div></div><div class="quick-actions-grid">${quickActions.map(([title, href, description, icon]) => `<a class="quick-action-card" href="${href}"><span class="quick-action-icon" aria-hidden="true">${icon}</span><span class="quick-action-copy"><b>${esc(title)}</b><small>${esc(description)}</small></span><span class="quick-action-arrow" aria-hidden="true">→</span></a>`).join("")}</div></section>`;
  if (!staff) {
    h += section("Payment tokens", tok, (t) => `<div class="card"><a href="#/token/${esc(t.id)}"><b>${esc(t.code || t.status)}</b></a> <span class="tag">${esc(humanize(t.status || ""))}</span>${kv(t)}<div class="row">${t.status === "ACTIVE" ? btn("claim", t.id, "I have paid") : ""}${["REQUESTED", "ACTIVE"].includes(t.status) ? btn("tcancel", t.id, "Cancel", "g") : ""}</div></div>`);
    h += section("My tenancy", ten, (t) => `<div class="card">${kv(t)}<div class="row">${btn("movein", t.id, "Confirm move-in")}${btn("renewreq", t.id, "Request renewal", "g")}<a class="button button-secondary" href="#/review/${esc(t.unitId || t.unit?.id || "")}">Leave a review</a>${(t.unitId || t.unit?.id) ? `<a class="button button-secondary" href="#/ticket/new?unitId=${esc(t.unitId || t.unit.id)}">Raise a ticket</a>` : ""}${btn("dl", "tenancies/" + t.id + "/agreement", "Download agreement", "g")}</div></div>`);
    h += section("Viewings", vw, (v) => `<div class="card">${kv(v)}<div class="row">${v.status === "RESCHEDULED" ? btn("vact", v.id, "Accept new time", "", "accept") : ""}${btn("vact", v.id, "Cancel viewing", "g", "cancel")}</div></div>`);
    h += section("Maintenance tickets", tk, (t) => `<div class="card"><a href="#/ticket/${esc(t.id)}"><b>${esc(t.title)}</b></a> <span class="tag">${esc(humanize(t.status || ""))}</span>${kv(t)}<div class="row">${t.status === "RESOLVED" ? btn("tconfirm", t.id, "Confirm fixed") + btn("treopen", t.id, "Reopen", "g") : ""}</div></div>`);
    h += section("Enquiries", d.enquiries || [], (e) => `<a class="card" href="#/chat/${esc(e.id)}"><b>${esc(e.unit?.title || e.title || "Conversation")}</b><span class="muted">Open conversation →</span></a>`);
    h += section("Saved homes", d.favourites || [], (f) => { const x = f.unit || f; return `<a class="card" href="#/unit/${esc(x.id)}">${img(x)}<b>${esc(x.title || "Saved home")}</b></a>`; });
  } else {
    h += section("Payment requests", inc, (t) => `<div class="card"><b>${esc(t.code || "Payment request")}</b> <span class="tag">${esc(humanize(t.status || ""))}</span>${kv(t)}<div class="row">${t.status === "REQUESTED" ? btn("approve", t.id, "Review & approve") + btn("reject", t.id, "Reject", "r") : ""}${t.status === "PAYMENT_CLAIMED" ? btn("confirmpay", t.id, "Confirm money received") + btn("notrec", t.id, "Not received", "r") : ""}</div></div>`);
    h += section("Viewing requests", vw, (v) => `<div class="card">${kv(v)}<div class="row">${v.status === "REQUESTED" ? btn("vact", v.id, "Confirm viewing") : ""}${v.status === "CONFIRMED" ? btn("vact", v.id, "Mark complete", "g", "complete") : ""}${btn("vact", v.id, "Cancel", "g", "cancel")}</div></div>`);
    h += section("Maintenance", tk, (t) => `<div class="card"><a href="#/ticket/${esc(t.id)}"><b>${esc(t.title)}</b></a> <span class="tag">${esc(humanize(t.status || ""))}</span> <span class="tag">${esc(humanize(t.urgency || ""))}</span><div class="row">${["ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED"].map((s) => btn("tstat", t.id, humanize(s), "g", s)).join("")}</div></div>`);
    h += section("Properties", props, (p) => `<div class="card"><a href="#/property/${esc(p.id)}"><b>${esc(p.name)}</b></a> <span class="tag">${esc(humanize(p.status || ""))}</span>${kv(p)}<div class="row">${u.role === "OWNER" ? ({ VERIFIED: btn("payfee", p.id, "Pay yearly fee"), EXPIRED: btn("renew", p.id, "Renew"), ACTIVE: btn("renew", p.id, "Renew early", "g"), DRAFT: "", NEEDS_CHANGES: btn("submit", p.id, "Resubmit"), DOCS_UPLOADED: btn("submit", p.id, "Submit for review") }[p.status] || "") : ""}</div></div>`);
    h += section("Units", units, (x) => `<div class="card"><b>${esc(x.title)}</b> <span class="tag">${esc(humanize(x.status || ""))}</span>${kv(x)}<div class="row">${x.status === "AVAILABLE" ? btn("unpub", x.id, "Take down", "g") : btn("pub", x.id, "Publish")}<a href="#/unitedit/${esc(x.id)}"><button class="g">Edit</button></a>${btn("delunit", x.id, "Delete", "r")}</div></div>`);
  }
  if (pageVersion !== activeRouteVersion) return;
  app.innerHTML = h;
}
async function chat(id) {
  const pageVersion = activeRouteVersion;
  const m = arr(await api(`enquiries/${id}/messages`)), me = user();
  if (pageVersion !== activeRouteVersion) return;
  app.innerHTML = `<section class="chat-page"><div class="page-heading"><div><p class="eyebrow"><span class="eyebrow-dot"></span> Direct conversation</p><h1>Messages</h1><p>Talk directly with the owner or tenant.</p></div></div><div class="chat-stream">${m.map((x) => `<div class="msg ${x.senderId === me?.id ? "me" : ""}">${esc(x.body)}</div>`).join("") || `<div class="empty-state">No messages yet. Start the conversation below.</div>`}</div><form id="mf" class="chat-form"><label class="sr-only" for="message-body">Your message</label><input id="message-body" name="body" placeholder="Write a message…" required><button type="submit">Send <span aria-hidden="true">→</span></button></form></section>`;
  document.getElementById("mf").onsubmit = async (e) => {
    e.preventDefault(); const button = e.target.querySelector("button"); button.disabled = true;
    try { await api(`enquiries/${id}/messages`, { body: { body: new FormData(e.target).get("body") } }); await chat(id); }
    catch (x) { say(x.message); button.disabled = false; }
  };
}
async function notes() {
  const pageVersion = activeRouteVersion;
  const d = await api("dashboard/notifications");
  if (pageVersion !== activeRouteVersion) return;
  const items = d?.items || [];
  app.innerHTML = `<section><div class="page-heading"><div><p class="eyebrow"><span class="eyebrow-dot"></span> Stay up to date</p><h1>Alerts & notices</h1><p>Important updates about your account and home.</p></div></div>${items.map((n) => `<article class="notice-card"><span class="notice-mark" aria-hidden="true">✦</span><div><b>${esc(n.title || humanize(n.type || "Notification"))}</b><p>${esc(n.body || n.message || "")}</p></div></article>`).join("") || `<div class="empty-state">You’re all caught up. New updates will appear here.</div>`}</section>`;
  api("dashboard/notifications/read", { body: {} }).catch(() => {});
}
function paymentComplete() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const reference = params.get("reference") || params.get("trxref") || "";
  app.innerHTML = `<section class="error-state" style="border-color:var(--sage-deep);background:var(--surface)"><div class="error-mark" style="color:var(--forest);background:var(--sage)">✓</div><p class="eyebrow">Payment update</p><h1>We received your return.</h1><p>We’re waiting for the verified payment notification. Your property status will update after the server confirms the payment. Please don’t pay again while it is processing.</p>${reference ? `<p class="muted">Reference: <b>${esc(reference)}</b></p>` : ""}<div class="error-actions"><a class="button" href="#/dash">Go to dashboard</a></div></section>`;
}
// ---------- actions ----------
const need = () => (user() ? true : (say("Please sign in first"), (location.hash = "#/login"), false));
async function startPropertyPayment(id, endpoint) {
  const d = await api(`properties/${id}/${endpoint}`, { body: {} });
  if (d.devMode && d.reference) {
    await api(`properties/${id}/pay/simulate`, { body: { reference: d.reference } });
    say("Demo fee recorded; no real payment was made.");
    const next = `#/property/${id}`;
    if (location.hash !== next) location.hash = next;
    else await EXTRA.property(id);
    return;
  }
  const url = d.authorization_url || d.authorizationUrl || d.url;
  if (url) location.href = url;
  else say(d.error || "Payment is unavailable.");
}
const A = {
  logout: () => logout(),
  enquire: async (id) => { if (!need()) return; const m = prompt("Your message to the owner:"); if (!m) return; const e = await api("enquiries", { body: { unitId: id, message: m } }); location.hash = "#/chat/" + (e.id || e.enquiry?.id); },
  viewing: async (id) => { if (!need()) return; const w = prompt("Preferred date and time (e.g. 2026-10-20 15:00):"); if (!w) return; await api("viewings", { body: { unitId: id, proposedAt: new Date(w.replace(" ", "T")).toISOString() } }); say("Viewing requested (free)"); },
  fav: async (id) => { if (!need()) return; await api("favourites", { body: { unitId: id } }); say("Saved"); },
  token: async (id) => { if (!need()) return; await api("tokens/request", { body: { unitId: id } }); say("Requested. The owner will review it."); location.hash = "#/dash"; },
  report: async (id) => { if (!need()) return; const r = prompt("Reason: FAKE_LISTING, ALREADY_RENTED, WRONG_PRICE, ASKED_TO_PAY_OFF_PLATFORM, SCAM_OR_FRAUD or OTHER", "OTHER"); if (r) { await api("reports", { body: { unitId: id, reason: r } }); say("Report sent"); } },
  claim: async (id) => { const f = new FormData(); f.append("reference", prompt("Transfer reference / session ID:") || ""); await api(`tokens/${id}/claim`, { form: f }); say("Sent to the owner to confirm"); },
  tcancel: (id) => api(`tokens/${id}/cancel`, { body: {} }),
  movein: (id) => api(`tenancies/${id}/confirm-move-in`, { body: {} }),
  vact: (id, x) => api(`viewings/${id}/action`, { body: { action: x } }),
  tconfirm: (id) => api(`tickets/${id}/confirm`, { body: {} }),
  treopen: (id) => api(`tickets/${id}/reopen`, { body: { reason: prompt("What is still wrong?") || "Not fixed" } }),
  issue: async (unitId) => { const c = prompt("Category: PLUMBING, ROOFING_LEAKAGE, ELECTRICAL, WATER_PUMP, SANITATION, SECURITY, APPLIANCE, OTHER", "PLUMBING"), t = prompt("Short title:"), d = prompt("Describe the problem:"), ur = prompt("Urgency: low, medium, high, emergency", "medium"); if (c && t && d) await api("tickets", { body: { unitId, category: c, title: t, description: d, urgency: (ur || "medium").toUpperCase() } }); },
  approve: (id) => api(`tokens/${id}/approve`, { body: {} }),
  reject: (id) => api(`tokens/${id}/reject`, { body: { reason: prompt("Reason:") || "Not available" } }),
  confirmpay: (id) => api(`tokens/${id}/confirm`, { body: { amountKobo: Math.round(Number(prompt("Amount received in naira (must equal the total due):")) * 100) } }),
  notrec: (id) => api(`tokens/${id}/not-received`, { body: {} }),
  tstat: (id, x) => api(`tickets/${id}/status`, { body: { status: x } }),
  payfee: (id) => startPropertyPayment(id, "pay"),
  renew: (id) => startPropertyPayment(id, "renew"),
  submit: (id) => api(`properties/${id}/submit`, { body: {} }),
  pub: (id) => api(`units/${id}/publish`, { body: {} }),
  unpub: (id) => api(`units/${id}/unpublish`, { body: {} }),
};
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-a]"); if (!b) return; e.preventDefault();
  const action = A[b.dataset.a];
  if (typeof action !== "function") return say("That action is not available right now.");
  b.disabled = true;
  const routeBeforeAction = location.hash;
  try { await action(b.dataset.id, b.dataset.x); if (location.hash === routeBeforeAction && /^#\/(dash|a\/|ticket\/|property\/|token\/)/.test(location.hash)) route(); }
  catch (x) { say(x.message || "Something went wrong. Please try again."); }
  finally { if (b.isConnected) b.disabled = false; }
});
function routeLoading() {
  app.innerHTML = `<div class="loading-panel" aria-label="Loading page"><span class="skeleton wide"></span><span class="skeleton medium"></span><span class="skeleton short"></span></div>`;
}
async function route() {
  const routeVersion = ++activeRouteVersion;
  const returnedReference = new URLSearchParams(location.search).get("reference") || new URLSearchParams(location.search).get("trxref");
  if (returnedReference && (!location.hash || location.hash === "#/")) {
    location.hash = "#/payment-complete?reference=" + encodeURIComponent(returnedReference);
    return;
  }
  const h = location.hash.replace(/^#/, "") || "/", p = h.split("?")[0].split("/");
  nav();
  app.setAttribute("aria-busy", "true"); routeLoading();
  try {
    if (p[1] === "unit") await unit(p[2]);
    else if (p[1] === "login") authForm(false);
    else if (p[1] === "register") authForm(true);
    else if (p[1] === "dash") await dash();
    else if (p[1] === "chat") await chat(p[2]);
    else if (p[1] === "notes") await notes();
    else if (p[1] === "search") await search();
    else if (p[1] === "payment-complete") paymentComplete();
    else if (EXTRA[p[1]]) await EXTRA[p[1]](p[2], p[3]);
    else await EXTRA.home();
  } catch (x) {
    // An error from an older route must not replace the page now on screen.
    if (routeVersion === activeRouteVersion) app.innerHTML = `<section class="error-state" role="alert"><div class="error-mark">!</div><p class="eyebrow">Something didn’t load</p><h1>Please try again.</h1><p>${esc(x.message || "We couldn’t load this page. Check your connection and try again.")}</p><div class="error-actions"><button type="button" data-retry>Try again</button><a class="button button-secondary" href="#/">Return home</a></div></section>`;
  } finally { if (routeVersion === activeRouteVersion) app.setAttribute("aria-busy", "false"); }
}
window.startDirectHomesApp = route;

