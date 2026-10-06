const API = window.API_URL || "", app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const user = () => { try { return JSON.parse(localStorage.getItem("u")); } catch { return null; } };
const arr = (d) => Array.isArray(d) ? d : d.items || d.results || d.tokens || d.tenancies || d.tickets || d.properties || d.units || d.viewings || [];
const naira = (n) => "₦" + Number(n).toLocaleString("en-NG");
const img = (u) => { const s = u.image || u.photo || u.cover || (u.images && u.images[0]) || (u.thumbnail); return s ? `<img loading="lazy" src="${API}${esc(s.url || s)}" alt="">` : ""; };
const prices = (u) => Object.entries(u).filter(([k, v]) => /rent|total|caution|service/i.test(k) && typeof v === "number").map(([k, v]) => `<div class="muted">${esc(k)}: <b>${naira(v)}</b></div>`).join("");
const kv = (o) => Object.entries(o).filter(([k, v]) => v !== null && typeof v !== "object" && !/^id$|Id$|password/i.test(k)).map(([k, v]) => `<div class="muted">${esc(k)}: <b>${esc(v)}</b></div>`).join("");
const say = (m) => { const t = document.getElementById("toast"); t.textContent = m; t.style.display = "block"; setTimeout(() => (t.style.display = "none"), 3500); };
const logout = () => { localStorage.clear(); location.hash = "#/login"; nav(); };

async function api(p, o = {}) {
  const go = () => fetch(API + "/api/" + p, { method: o.method || (o.body || o.form ? "POST" : "GET"), headers: { ...(o.form ? {} : { "Content-Type": "application/json" }), ...(localStorage.at ? { Authorization: "Bearer " + localStorage.at } : {}) }, body: o.form || (o.body ? JSON.stringify(o.body) : undefined) });
  let r = await go();
  if (r.status === 401 && localStorage.rt) {
    const rr = await fetch(API + "/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: localStorage.rt }) });
    if (rr.ok) { localStorage.at = (await rr.json()).accessToken; r = await go(); } else { logout(); throw new Error("Please sign in again"); }
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || (d.fieldErrors ? Object.values(d.fieldErrors).flat().join(", ") : "Something went wrong"));
  return d;
}
function nav() {
  const u = user(), d = u ? `<a href="#/dash">Dashboard</a><a href="#/notes">Notifications</a><a href="#" data-a="logout">Sign out</a>` : `<a href="#/login">Sign in</a><a href="#/register">Register</a>`;
  document.getElementById("nav").innerHTML = `<a href="#/">Search</a>${d}`;
}
const section = (t, items, fn) => `<h3>${t} (${items.length})</h3>${items.length ? `<div class="grid">${items.map(fn).join("")}</div>` : `<p class="muted">Nothing here yet.</p>`}`;
const btn = (a, id, label, cls = "", x = "") => `<button class="${cls}" data-a="${a}" data-id="${esc(id)}" data-x="${esc(x)}">${label}</button>`;

// ---------- pages ----------
async function search() {
  const f = new URLSearchParams(location.hash.split("?")[1] || "");
  app.innerHTML = `<h2>Find a home. No agents, no viewing fees.</h2><form id="sf" class="row"><input name="q" placeholder="Area, city or keyword" value="${esc(f.get("q") || "")}"><input name="minRent" type="number" placeholder="Min ₦" value="${esc(f.get("minRent") || "")}"><input name="maxRent" type="number" placeholder="Max ₦" value="${esc(f.get("maxRent") || "")}"><input name="bedrooms" type="number" placeholder="Bedrooms" value="${esc(f.get("bedrooms") || "")}"><button>Search</button></form><div id="res" class="grid">Loading…</div>`;
  document.getElementById("sf").onsubmit = (e) => { e.preventDefault(); const p = new URLSearchParams([...new FormData(e.target)].filter(([, v]) => v)); location.hash = "#/search?" + p; };
  const d = await api("public/units?" + f);
  document.getElementById("res").innerHTML = arr(d).map((u) => `<a class="card" href="#/unit/${esc(u.id)}" style="text-decoration:none;color:inherit">${img(u)}<h4>${esc(u.title)}</h4><div class="muted">${esc(u.location?.name || u.locationName || u.area || "")}</div>${prices(u)}</a>`).join("") || "<p>No homes match. Try fewer filters.</p>";
}
async function unit(id) {
  const u = await api("public/units/" + id);
  app.innerHTML = `<div class="card"><div class="gal">${(u.images || []).map((i) => `<img src="${API}${esc(i)}" alt="">`).join("")}</div><h2>${esc(u.title)}</h2><p>${esc(u.address || "")}</p><p>${esc(u.description || "")}</p>${prices(u)}<p>${(u.features || []).map((f) => `<span class="tag">${esc(f.name || f.feature?.name || f)}</span>`).join(" ")}</p>
  <div class="row">${btn("enquire", id, "Message owner")}${btn("viewing", id, "Book a free viewing", "g")}${btn("fav", id, "♡ Save", "g")}${btn("token", id, "Request payment token")}${btn("report", id, "Report listing", "r")}</div><p class="muted">No inspection fee. You pay rent directly to the owner's verified account after the owner approves your token.</p></div>`;
}
function authForm(reg) {
  app.innerHTML = `<h2>${reg ? "Create account" : "Sign in"}</h2><form id="af" class="row" style="flex-direction:column;max-width:380px">${reg ? `<select name="role"><option value="TENANT">I'm looking for a home</option><option value="OWNER">I own property</option><option value="MANAGER">I manage property</option></select><input name="fullName" placeholder="Full name" required><input name="phone" placeholder="Phone e.g. 08012345678" required>` : ""}<input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password (8+ characters)" required><button>${reg ? "Register" : "Sign in"}</button></form>`;
  document.getElementById("af").onsubmit = async (e) => { e.preventDefault(); try { const d = await api("auth/" + (reg ? "register" : "login"), { body: Object.fromEntries(new FormData(e.target)) }); localStorage.at = d.accessToken; localStorage.rt = d.refreshToken; localStorage.u = JSON.stringify(d.user); nav(); location.hash = "#/dash"; } catch (x) { say(x.message); } };
}
async function dash() {
  const u = user(); if (!u) return (location.hash = "#/login");
  if (u.role === "ADMIN") return (location.hash = "#/a/overview");
  const staff = u.role !== "TENANT", d = await api("dashboard/" + (staff ? "staff" : "tenant"));
  const stats = Object.entries(d).filter(([, v]) => typeof v === "number").map(([k, v]) => `<div><b>${v}</b>${esc(k.replace(/([A-Z])/g, " $1").toLowerCase())}</div>`).join("");
  let h = `<h2>Hello, ${esc(u.fullName || "")}</h2><div class="stats">${stats}</div>`;
  const get = async (p) => { try { return arr(await api(p)); } catch { return []; } };
  if (!staff) {
    const [tok, ten, tk, vw] = await Promise.all([get("tokens/mine"), get("tenancies/mine"), get("tickets/mine"), get("viewings/mine")]);
    h += section("Payment tokens", tok, (t) => `<div class="card"><a href="#/token/${esc(t.id)}"><b>${esc(t.code || t.status)}</b></a> <span class="tag">${esc(t.status)}</span>${kv(t)}<div class="row">${t.status === "ACTIVE" ? btn("claim", t.id, "I have paid") : ""}${["REQUESTED", "ACTIVE"].includes(t.status) ? btn("tcancel", t.id, "Cancel", "g") : ""}</div></div>`);
    h += section("My tenancy", ten, (t) => `<div class="card">${kv(t)}<div class="row">${btn("movein", t.id, "Confirm move-in")}${btn("renewreq", t.id, "Request renewal", "g")}<a href="#/review/${esc(t.unitId || t.unit?.id || "")}">Review</a>${btn("issue", t.unitId || t.unit?.id || "", "Report an issue", "g")}${btn("dl", "tenancies/" + t.id + "/agreement", "Agreement", "g")}</div></div>`);
    h += section("Viewings", vw, (v) => `<div class="card">${kv(v)}<div class="row">${v.status === "RESCHEDULED" ? btn("vact", v.id, "Accept new time", "", "accept") : ""}${btn("vact", v.id, "Cancel", "g", "cancel")}</div></div>`);
    h += section("Maintenance tickets", tk, (t) => `<div class="card"><a href="#/ticket/${esc(t.id)}"><b>${esc(t.title)}</b></a> <span class="tag">${esc(t.status)}</span>${kv(t)}<div class="row">${t.status === "RESOLVED" ? btn("tconfirm", t.id, "Confirm fixed") + btn("treopen", t.id, "Reopen", "g") : ""}</div></div>`);
    h += section("Enquiries (chat)", d.enquiries || [], (e) => `<a class="card" href="#/chat/${esc(e.id)}">${esc(e.unit?.title || e.title || "Chat")}</a>`);
    h += section("Saved homes", d.favourites || [], (f) => { const x = f.unit || f; return `<a class="card" href="#/unit/${esc(x.id)}">${esc(x.title)}</a>`; });
  } else {
    const [inc, tk, props, units, vw] = await Promise.all([get("tokens/incoming"), get("tickets/staff"), get("properties/mine"), get("units/mine"), get("viewings/mine")]);
    h += section("Payment requests", inc, (t) => `<div class="card"><b>${esc(t.code || "Request")}</b> <span class="tag">${esc(t.status)}</span>${kv(t)}<div class="row">${t.status === "REQUESTED" ? btn("approve", t.id, "Approve") + btn("reject", t.id, "Reject", "r") : ""}${t.status === "PAYMENT_CLAIMED" ? btn("confirmpay", t.id, "Confirm money received") + btn("notrec", t.id, "Not received", "r") : ""}</div></div>`);
    h += section("Viewing requests", vw, (v) => `<div class="card">${kv(v)}<div class="row">${v.status === "REQUESTED" ? btn("vact", v.id, "Confirm", "", "confirm") : ""}${v.status === "CONFIRMED" ? btn("vact", v.id, "Mark done", "", "complete") : ""}${btn("vact", v.id, "Cancel", "g", "cancel")}</div></div>`);
    h += section("Maintenance", tk, (t) => `<div class="card"><a href="#/ticket/${esc(t.id)}"><b>${esc(t.title)}</b></a> <span class="tag">${esc(t.status)}</span> <span class="tag">${esc(t.urgency)}</span><div class="row">${["ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED"].map((s) => btn("tstat", t.id, s.replace("_", " ").toLowerCase(), "g", s)).join("")}</div></div>`);
    h += section("Properties", props, (p) => `<div class="card"><a href="#/property/${esc(p.id)}"><b>${esc(p.name)}</b></a> <span class="tag">${esc(p.status)}</span>${kv(p)}<div class="row">${u.role === "OWNER" ? ({ VERIFIED: btn("payfee", p.id, "Pay yearly fee"), EXPIRED: btn("renew", p.id, "Renew"), ACTIVE: btn("renew", p.id, "Renew early", "g"), DRAFT: "", NEEDS_CHANGES: btn("submit", p.id, "Resubmit"), DOCS_UPLOADED: btn("submit", p.id, "Submit for review") }[p.status] || "") : ""}</div></div>`);
    h += section("Units", units, (x) => `<div class="card"><b>${esc(x.title)}</b> <span class="tag">${esc(x.status)}</span>${kv(x)}<div class="row">${x.status === "AVAILABLE" ? btn("unpub", x.id, "Take down", "g") : btn("pub", x.id, "Publish")}<a href="#/unitedit/${esc(x.id)}"><button class="g">Edit</button></a>${btn("delunit", x.id, "Delete", "r")}</div></div>`);
  }
  app.innerHTML = h;
}
async function chat(id) {
  const m = arr(await api(`enquiries/${id}/messages`)), me = user();
  app.innerHTML = `<h2>Chat</h2>${m.map((x) => `<div class="msg ${x.senderId === me.id ? "me" : ""}">${esc(x.body)}</div>`).join("") || "<p class='muted'>No messages yet.</p>"}<form id="mf" class="row"><input name="body" placeholder="Type a message" required><button>Send</button></form>`;
  document.getElementById("mf").onsubmit = async (e) => { e.preventDefault(); try { await api(`enquiries/${id}/messages`, { body: { body: new FormData(e.target).get("body") } }); chat(id); } catch (x) { say(x.message); } };
}
async function notes() {
  const d = await api("dashboard/notifications");
  app.innerHTML = `<h2>Notifications</h2>${(d.items || []).map((n) => `<div class="card" style="margin:8px 0"><b>${esc(n.title || n.type)}</b><div>${esc(n.body || n.message || "")}</div></div>`).join("") || "<p>All caught up.</p>"}`;
  api("dashboard/notifications/read", { body: {} }).catch(() => {});
}

function paymentComplete() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const reference = params.get("reference") || params.get("trxref") || "";
  app.innerHTML = `<div class="card"><h2>Payment return received</h2><p>We are waiting for the verified Paystack notification. Your property status updates only after the server confirms the payment.</p><p>Please do not pay again while it is processing. Refresh your dashboard shortly.</p>${reference ? `<p>Reference: <b>${esc(reference)}</b></p>` : ""}<a href="#/dash">Go to dashboard</a></div>`;
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
  try { await A[b.dataset.a](b.dataset.id, b.dataset.x); if (/^#\/(dash|a\/|ticket\/)/.test(location.hash)) route(); } catch (x) { say(x.message); }
});
async function route() {
  const returnedReference = new URLSearchParams(location.search).get("reference") || new URLSearchParams(location.search).get("trxref");
  if (returnedReference && (!location.hash || location.hash === "#/")) {
    location.hash = "#/payment-complete?reference=" + encodeURIComponent(returnedReference);
    return;
  }
  const h = location.hash.replace(/^#/, "") || "/", p = h.split("?")[0].split("/");
  nav();
  try { if (p[1] === "unit") await unit(p[2]); else if (p[1] === "login") authForm(false); else if (p[1] === "register") authForm(true); else if (p[1] === "dash") await dash(); else if (p[1] === "chat") await chat(p[2]); else if (p[1] === "notes") await notes(); else if (p[1] === "search") await search(); else if (p[1] === "payment-complete") paymentComplete(); else if (EXTRA[p[1]]) await EXTRA[p[1]](p[2], p[3]); else await EXTRA.home(); }
  catch (x) { app.innerHTML = `<p class="card">⚠️ ${esc(x.message)}</p>`; }
}
window.startDirectHomesApp = route;

