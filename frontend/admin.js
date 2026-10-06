// Single admin place: everything the old /admin console did, plus tickets, reports, reviews, disputes, analytics
const LEVELS = ["STATE", "LGA", "CITY", "AREA"], qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
const list = (d) => (Array.isArray(d) ? d : Object.values(d || {}).find(Array.isArray) || []);
const grid = (rows, fn) => `<div class="grid">${rows.map(fn).join("") || `<div class="empty-state">Nothing needs attention here right now.</div>`}</div>`;
const files = (o) => [...new Set((JSON.stringify(o).match(/[\w-]+\.(?:jpg|png|webp|pdf)/g) || []))];
const fbox = (k) => `<div class="card"><span class="muted">${esc(k)}</span><div data-file="${esc(k)}">Loading…</div></div>`;
async function loadFiles() {
  for (const box of document.querySelectorAll("[data-file]")) {
    try {
      const r = await fetch(API + "/api/admin/files/" + box.dataset.file, { headers: { Authorization: "Bearer " + localStorage.at } });
      if (!r.ok) { box.textContent = "This file is unavailable."; continue; }
      const blob = await r.blob(), url = URL.createObjectURL(blob);
      box.innerHTML = blob.type.startsWith("image") ? `<img src="${url}" alt="Uploaded document" style="max-width:100%;border-radius:10px">` : `<a href="${url}" target="_blank" rel="noopener">Open document</a>`;
    } catch { box.textContent = "This file could not be loaded."; }
  }
}
const title = (r) => r.user?.fullName || r.owner?.fullName || r.fullName || r.name || r.title || r.code || r.action || "";
const link = (h, r) => `<a href="#/a/${h}/${esc(r.id)}"><b>${esc(title(r) || r.id)}</b></a>`;
const chk = (id, t) => `<label><input type="checkbox" id="${id}" style="flex:none"> ${t}</label>`;
const decRow = (a, id, ds) => `<div class="row">${ds.map(([d, t, c]) => btn(a, id, t, c || "", d)).join("")}</div>`;
const adminNotesHtml = '<label>Notes<textarea id="notes"></textarea></label>';
const queue = (path, acts) => async () => grid(list(await api(path)), (r) => `<div class="card">${kv(r)}<div class="row">${acts(r)}</div></div>`);
const crud = (path, cols) => async () => {
  const rows = list(await api("admin/" + path));
  return `<div class="row">${btn("addres", path, "Add new")}</div>` + grid(rows, (r) => `<div class="card"><b>${esc(r.name)}</b> <span class="tag">${r.active ? "active" : "disabled"}</span>${kv(r)}<div class="row">${btn("atoggle", r.id, r.active ? "Disable" : "Enable", "g", path + "|" + r.active)}${path === "fee-tiers" ? btn("tieramt", r.id, "Edit price", "g") : ""}</div></div>`);
};
const ADM = {
  overview: async () => {
    const d = await api("admin/stats");
    const metrics = [["owners", "Property owners", "users"], ["managers", "Managers", "users"], ["tenants", "Residents", "users"], ["pendingKyc", "Identity reviews", "kyc"], ["pendingProperties", "Property reviews", "properties"], ["suspended", "Restricted accounts", "reports"]];
    const attention = Number(d.pendingKyc || 0) + Number(d.pendingProperties || 0);
    return `<div class="admin-overview">
      <section class="admin-overview-hero"><div class="admin-overview-copy"><p class="workspace-eyebrow"><span class="workspace-live-dot"></span> ADMIN CONTROL ROOM</p><h2>Good operations<br><em>start with clarity.</em></h2><p>See the people, properties and decisions shaping your marketplace—then move the important work forward.</p><div class="admin-hero-actions"><a href="#/a/kyc" class="admin-hero-link"><span>Owner verification</span><b>${esc(d.pendingKyc ?? 0)}</b><i aria-hidden="true">→</i></a><a href="#/a/properties" class="admin-hero-link"><span>Property reviews</span><b>${esc(d.pendingProperties ?? 0)}</b><i aria-hidden="true">→</i></a></div></div><div class="admin-overview-art" aria-hidden="true"><span class="admin-orbit admin-orbit-one"></span><span class="admin-orbit admin-orbit-two"></span><div class="admin-brand-seal"><img src="assets/direct-homes-logo-mark.webp" width="512" height="512" alt=""><span>DIRECT HOMES<br><b>OPERATIONS</b></span></div><div class="admin-attention-card"><small>Review workload</small><strong>${esc(attention)}</strong><span>items to triage</span></div><span class="admin-art-spark">✦</span></div></section>
      <div class="overview-metrics-heading"><div><p class="eyebrow"><span class="eyebrow-dot"></span> Marketplace pulse</p><h2>Platform at a glance</h2></div><span class="overview-update"><span></span> Live overview</span></div>
      <div class="admin-stat-grid admin-color-metrics">${metrics.map(([key, label, icon], i) => `<article class="stat-card stat-tone-${i % 5} admin-metric-card"><div class="stat-card-top"><span class="stat-card-icon">${navIcon(icon)}</span><span class="stat-card-overline">PLATFORM</span></div><strong>${esc(d[key] ?? 0)}</strong><span class="admin-stat-label">${esc(label)}</span></article>`).join("")}</div>
      <div class="admin-overview-bottom"><section class="admin-review-panel"><div class="overview-card-heading"><div><p class="eyebrow"><span class="eyebrow-dot"></span> Keep things moving</p><h3>Review queues</h3></div><span class="overview-card-mark">✓</span></div><a class="admin-review-row" href="#/a/kyc"><span class="admin-review-icon tone-gold">${navIcon("kyc")}</span><span><b>Owner verification</b><small>Check identity details before approval</small></span><b class="admin-review-count">${esc(d.pendingKyc ?? 0)}</b><i aria-hidden="true">→</i></a><a class="admin-review-row" href="#/a/properties"><span class="admin-review-icon tone-sage">${navIcon("properties")}</span><span><b>Property submissions</b><small>Review documents and listing readiness</small></span><b class="admin-review-count">${esc(d.pendingProperties ?? 0)}</b><i aria-hidden="true">→</i></a><a class="admin-review-row" href="#/a/accounts"><span class="admin-review-icon tone-blue">${navIcon("accounts")}</span><span><b>Receiving accounts</b><small>Approve owner payout details safely</small></span><b class="admin-review-count admin-review-arrow">Open</b><i aria-hidden="true">→</i></a><a class="admin-review-row" href="#/a/tickets"><span class="admin-review-icon tone-rose">${navIcon("tickets")}</span><span><b>Support and maintenance</b><small>Keep tenant issues on track</small></span><b class="admin-review-count admin-review-arrow">Open</b><i aria-hidden="true">→</i></a></section>
      <section class="admin-shortcut-panel"><div class="overview-card-heading"><div><p class="eyebrow"><span class="eyebrow-dot"></span> Admin toolkit</p><h3>Useful shortcuts</h3></div><span class="overview-card-mark overview-card-mark-gold">↗</span></div><p>Explore the parts of your workspace you use most.</p><div class="admin-shortcuts"><a href="#/a/users">People &amp; access<span aria-hidden="true">→</span></a><a href="#/a/analytics">Platform analytics<span aria-hidden="true">→</span></a><a href="#/a/audit">Audit log<span aria-hidden="true">→</span></a><a href="#/a/fees">Fee settings<span aria-hidden="true">→</span></a></div><div class="admin-trust-note"><span aria-hidden="true">✦</span><span><b>Built on trust</b><small>Keep every review thoughtful and transparent.</small></span></div></section></div>
    </div>`;
  },
  analytics: async () => `<div class="card"><p class="eyebrow">Platform activity</p><h3>Analytics overview</h3>${deep(await api("admin/analytics/overview"))}</div><div class="row">${["onboarding", "rent", "tickets", "users"].map((x) => btn("dl", `admin/export/${x}.csv`, `Download ${x} CSV`, "g")).join("")}</div>`,
  async kyc(id) {
    if (!id) return grid(list(await api("admin/kyc?status=" + (qs().get("status") || "PENDING"))), (r) => `<div class="card">${link("kyc", r)}${kv(r)}</div>`);
    const d = await api("admin/kyc/" + id);
    return `<p><a href="#/a/kyc">← Back to queue</a></p><div class="card">${deep(d)}</div><div class="grid">${files(d).map(fbox).join("")}</div><div class="card"><h3>Decision</h3>${chk("c1", "Name matches ID")}${chk("c2", "Selfie matches ID photo")}${chk("c3", "Document looks genuine")}${chk("bl", "Blacklist this ID, phone and bank account (fraud)")}${adminNotesHtml}${decRow("kycdec", id, [["APPROVED", "Approve"], ["NEEDS_INFO", "Need more info", "g"], ["REJECTED", "Reject", "r"]])}</div>`;
  },
  async properties(id) {
    if (!id) { const s = qs().get("status") || "PENDING_REVIEW"; return `<p class="tabs">${["PENDING_REVIEW", "VERIFIED", "ACTIVE", "EXPIRED", "NEEDS_CHANGES", "REJECTED"].map((x) => `<a href="#/a/properties?status=${x}">${x.toLowerCase().replace("_", " ")}</a>`).join("")}</p>` + grid(list(await api("admin/properties?status=" + s)), (r) => `<div class="card">${link("properties", r)} <span class="tag">${esc(r.status)}</span>${kv(r)}</div>`); }
    const p = await api("admin/properties/" + id), docs = p.documents || [], auth = Object.entries(p).find(([k, v]) => /auth/i.test(k) && Array.isArray(v))?.[1] || [];
    return `<p><a href="#/a/properties">← Back</a></p><div class="card"><h2>${esc(p.name)} <span class="tag">${esc(p.status)}</span></h2>${deep(Object.fromEntries(Object.entries(p).filter(([k]) => !["documents", "children"].includes(k) && !/auth/i.test(k))))}</div>
    <h3>Ownership documents</h3><div class="grid">${docs.map((d) => `<div class="card"><b>${esc(d.docType)}</b> <span class="tag">${esc(d.status)}</span>${fbox(d.fileUrl)}${d.rejectReason ? `<p class="muted">${esc(d.rejectReason)}</p>` : ""}${d.status === "PENDING" ? decRow("docdec", id + "|" + d.id, [["APPROVED", "Approve"], ["REJECTED", "Reject", "r"]]) : ""}</div>`).join("") || "<p class='muted'>No documents</p>"}</div>
    ${auth.length ? `<h3>Manager authorisation letters</h3><div class="grid">${auth.map((a) => `<div class="card">${kv(a)}${files(a).map(fbox).join("")}${a.status === "PENDING" ? decRow("authdec", id + "|" + a.id, [["APPROVED", "Approve"], ["REJECTED", "Reject", "r"]]) : ""}</div>`).join("")}</div>` : ""}
    ${["PENDING_REVIEW", "DOCS_UPLOADED"].includes(p.status) ? `<div class="card"><h3>Decision</h3>${chk("k1", "Owner is verified")}${chk("k2", "Documents look genuine")}${chk("k3", "Address and location match the documents")}${chk("k4", "Not a duplicate of another listing")}${adminNotesHtml}${decRow("propdec", id, [["APPROVED", "Verify property"], ["NEEDS_CHANGES", "Needs changes", "g"], ["REJECTED", "Reject", "r"]])}</div>` : ""}
    ${["ACTIVE", "EXPIRED"].includes(p.status) ? `<div class="card"><h3>Overrides</h3><div class="row">${btn("extend", id, "Extend period", "g")}${btn("revoke", id, "Revoke / hide", "r")}</div></div>` : ""}`;
  },
  async users() {
    const q = qs(), rows = list(await api("admin/users?" + q));
    return `<form data-form="ufilter" class="row"><input name="q" placeholder="Name or email" value="${esc(q.get("q") || "")}"><select name="role"><option value="">All roles</option>${["OWNER", "MANAGER", "TENANT", "ADMIN"].map((x) => `<option ${q.get("role") === x ? "selected" : ""}>${x}</option>`).join("")}</select><select name="status"><option value="">Any status</option>${["ACTIVE", "SUSPENDED", "BANNED"].map((x) => `<option ${q.get("status") === x ? "selected" : ""}>${x}</option>`).join("")}</select><button>Filter</button></form>` + grid(rows, (r) => `<div class="card"><b>${esc(r.fullName)}</b> <span class="tag">${esc(r.role)}</span> <span class="tag">${esc(r.status)}</span>${kv(r)}<div class="row">${["ACTIVE", "SUSPENDED", "BANNED"].filter((s) => s !== r.status).map((s) => btn("ustat", r.id, s.toLowerCase(), s === "ACTIVE" ? "" : "r", s)).join("")}</div></div>`);
  },
  features: crud("features"), "unit-types": crud("unit-types"), fees: crud("fee-tiers"),
  async locations() {
    const parent = qs().get("parent") || "", rows = list(await api("admin/locations" + (parent ? "?parentId=" + parent : "")));
    return `<p>${parent ? `<a href="#/a/locations">All states</a> · ` : ""}Showing ${parent ? "children of " + esc(qs().get("name")) : "top level"}</p><div class="row">${btn("addres", "locations", "Add location", "", parent)}</div>` + grid(rows, (r) => `<div class="card"><b>${esc(r.name)}</b> <span class="tag">${esc(r.level || "")}</span> <span class="tag">${r.active ? "active" : "disabled"}</span><div class="row"><a href="#/a/locations?parent=${esc(r.id)}&name=${encodeURIComponent(r.name)}"><button class="g">Open</button></a>${btn("atoggle", r.id, r.active ? "Disable" : "Enable", "g", "locations|" + r.active)}</div></div>`);
  },
  audit: async () => grid(list(await api("admin/audit-logs")), (r) => `<div class="card"><b>${esc(r.action)}</b>${kv(r)}</div>`),
  accounts: queue("admin/accounts?status=PENDING_REVIEW", (a) => btn("accreveal", a.id, "Show number", "g") + btn("aacc", a.id, "Approve", "", "APPROVED") + btn("aacc", a.id, "Reject", "r", "REJECTED")),
  tickets: queue("admin/tickets", (t) => btn("amed", t.id, "Mediate", "g")),
  reports: queue("admin/reports", (r) => btn("arep", r.unitId || r.id, "Dismiss", "g", "DISMISS") + btn("arep", r.unitId || r.id, "Take down", "r", "TAKE_DOWN")),
  reviews: queue("admin/reviews", (r) => btn("ahide", r.id, "Hide", "r")),
  disputes: queue("admin/tokens?status=DISPUTED", (t) => btn("ares", t.id, "Mark paid", "", "CONFIRM_PAID") + btn("ares", t.id, "Cancel", "r", "CANCEL")),
};
EXTRA.a = async (s = "overview", id) => {
  if (!ADM[s]) s = "overview";
  app.innerHTML = `<section class="admin-page"><div class="page-heading admin-heading"><div><p class="eyebrow"><span class="eyebrow-dot"></span> Secure operations</p><h1>Admin workspace</h1><p>Review accounts, listings and platform activity. Choose a section from the left-hand menu.</p></div><span class="admin-status">Administrator access</span></div><div id="ab" class="admin-content"><div class="loading-panel"><span class="skeleton wide"></span><span class="skeleton medium"></span><span class="skeleton short"></span></div></div></section>`;
  const panel = document.getElementById("ab");
  try { panel.innerHTML = await ADM[s](id); await loadFiles(); }
  catch (x) { panel.innerHTML = `<section class="error-state" role="alert"><div class="error-mark">!</div><p class="eyebrow">Could not load this section</p><h1>Let’s try that again.</h1><p>${esc(x.message || "The request did not complete.")}</p><div class="error-actions"><button type="button" data-retry>Retry section</button><a class="button button-secondary" href="#/a/overview">Back to overview</a></div></section>`; }
};
const dv = (id) => id.split("|"), val = (i) => document.getElementById(i)?.checked, nt = () => document.getElementById("notes")?.value || "";
FORMS.ufilter = (f) => (location.hash = "#/a/users?" + new URLSearchParams(Object.entries(f).filter(([, v]) => v)));
Object.assign(A, {
  kycdec: (id, d) => api(`admin/kyc/${id}/decision`, { body: { decision: d, notes: nt(), checklist: { nameMatches: val("c1"), selfieMatches: val("c2"), documentGenuine: val("c3") }, blacklist: val("bl") } }).then(() => { say("Decision saved"); location.hash = "#/a/kyc"; }),
  propdec: (id, d) => api(`admin/properties/${id}/decision`, { body: { decision: d, notes: nt(), checklist: { ownerVerified: val("k1"), docsGenuine: val("k2"), addressMatches: val("k3"), noDuplicate: val("k4") } } }).then(() => { say("Decision saved"); location.hash = "#/a/properties"; }),
  docdec: async (k, d) => { const [p, doc] = dv(k), run = (reason) => api(`admin/properties/${p}/documents/${doc}/decision`, { body: { decision: d, reason } }); if (d === "REJECTED") await go("Reject document", [T("r", "Reason")], (v) => run(v.r), "Reject"); else await run(undefined); },
  authdec: (k, d) => { const [p, a] = dv(k); return api(`admin/authorisations/${a}/decision`, { body: { decision: d } }); },
  extend: (id) => go("Extend active period", [{ n: "d", l: "Days", t: "number", req: 1, min: 1, v: 30 }, T("r", "Reason")], (v) => api(`admin/properties/${id}/extend`, { body: { days: Number(v.d), reason: v.r } }).then(() => say("Extended")), "Extend"),
  revoke: (id) => go("Revoke and hide property", [T("r", "Reason")], (v) => api(`admin/properties/${id}/revoke`, { body: { reason: v.r } }).then(() => say("Hidden")), "Revoke"),
  ustat: (id, s) => go("Change account status to " + s.toLowerCase(), [T("r", "Reason")], (v) => api(`admin/users/${id}/status`, { method: "PATCH", body: { status: s, reason: v.r } }), "Confirm"),
  atoggle: (id, x) => { const [path, active] = x.split("|"); return api(`admin/${path}/${id}`, { method: "PATCH", body: { active: active !== "true" } }); },
  tieramt: (id) => go("Edit yearly fee", [{ n: "a", l: "Amount (₦)", t: "number", req: 1, min: 1 }], (v) => api("admin/fee-tiers/" + id, { method: "PATCH", body: { amountNaira: Number(v.a) } })),
  accreveal: async (id) => say(JSON.stringify(await api(`admin/accounts/${id}/reveal`))),
  addres: (path, parent) => {
    const F = { features: [{ n: "name", l: "Name", req: 1 }, { n: "category", l: "Category (e.g. Utilities)" }], "unit-types": [{ n: "name", l: "Name", req: 1 }], locations: [{ n: "name", l: "Name", req: 1 }, { n: "level", l: "Level", t: "select", o: LEVELS.map((x) => [x, x]) }], "fee-tiers": [{ n: "name", l: "Tier name", req: 1 }, { n: "kind", l: "Property kind", t: "select", o: [["HOUSE", "House"], ["BUILDING", "Building"], ["ESTATE", "Estate (individually owned)"]] }, { n: "minUnits", l: "Min units", t: "number", min: 1, v: 1 }, { n: "maxUnits", l: "Max units (blank = no limit)", t: "number", min: 1 }, { n: "amountNaira", l: "Yearly fee (₦)", t: "number", req: 1, min: 1 }] }[path];
    return go("Add", F, (v) => { const b = { ...v }; if (path === "fee-tiers") { b.minUnits = Number(v.minUnits); b.amountNaira = Number(v.amountNaira); if (v.maxUnits) b.maxUnits = Number(v.maxUnits); else delete b.maxUnits; } if (path === "locations" && parent) b.parentId = parent; for (const k in b) if (b[k] === "") delete b[k]; return api("admin/" + path, { body: b }); });
  },
});
