const EXTRA = {}, FORMS = {};
const TABS = [["overview", "Overview"], ["kyc", "Owner verification"], ["properties", "Properties"], ["users", "Users"], ["accounts", "Bank accounts"], ["tickets", "Tickets"], ["reports", "Reported listings"], ["reviews", "Reviews"], ["disputes", "Payment disputes"], ["analytics", "Analytics"], ["features", "Features"], ["unit-types", "Unit types"], ["locations", "Locations"], ["fees", "Onboarding fees"], ["audit", "Audit log"]];
const NAV_ICON_PATHS = {
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  dash: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  overview: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  news: '<path d="M5 4.5h10l4 4v11H5z"/><path d="M15 4.5v4h4M8 12h8M8 16h8"/>',
  notes: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  onboard: '<path d="m12 3 8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="m9 12 2 2 4-4"/>',
  pnew: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>',
  unitnew: '<path d="M4 20V5l8-2 8 2v15M2.5 20h19"/><path d="M8 8h1M15 8h1M8 12h1M15 12h1M10 20v-4h4v4"/>',
  announce: '<path d="M4 14V9a2 2 0 0 1 2-2h3l8-3v15l-8-3H6a2 2 0 0 1-2-2Z"/><path d="m8 16 1.5 4h3L11 16M20 9l2-1M20 14l2 1"/>',
  insights: '<path d="M4 19V5M4 19h17"/><path d="m7 15 4-4 3 2 6-7"/>',
  kyc: '<path d="m12 3 8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="m9 12 2 2 4-4"/>',
  properties: '<path d="m3 11 9-7 9 7v9H3z"/><path d="M9 20v-6h6v6"/>',
  users: '<path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20"/><circle cx="9.5" cy="7.5" r="3.5"/><path d="M17 11a3.5 3.5 0 1 0 0-7M17 14.5h1a4 4 0 0 1 4 4V20"/>',
  accounts: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  tickets: '<path d="m14 7 3 3M5 19l4-.8 10-10a2.1 2.1 0 0 0-3-3l-10 10L5 19Z"/><path d="m13 5 3 3"/>',
  reports: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  reviews: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.9-5.4 2.9 1-6-4.4-4.3 6.1-.9z"/>',
  disputes: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M8 15h3"/>',
  analytics: '<path d="M4 19V5M4 19h17"/><path d="m7 15 4-4 3 2 6-7"/>',
  features: '<path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  'unit-types': '<path d="M4 20V5l8-2 8 2v15M2.5 20h19"/><path d="M8 8h1M15 8h1M8 12h1M15 12h1"/>',
  locations: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.2"/>',
  fees: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5c-.7-.8-1.7-1.2-3.1-1.2-1.5 0-2.6.7-2.6 1.8 0 2.8 5.8 1.1 5.8 4.4 0 1.4-1.3 2.4-3.2 2.4-1.3 0-2.4-.4-3.3-1.3M12 6v12"/>',
  audit: '<path d="M4 7h12M4 12h9M4 17h6"/><circle cx="18" cy="16" r="3"/><path d="M18 14.5V16l1 1"/>',
  login: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M13 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/>',
  register: '<circle cx="9" cy="8" r="4"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M19 8v6M16 11h6"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M13 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/>',
};
const NAV_TABS = TABS;
const L = (l, inner) => `<label>${l}${inner}</label>`;
const inp = (n, l, t = "text", x = "") => L(l, `<input name="${n}" type="${t}" ${x}>`);
const opts = (a) => a.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");
const up = (file, path = "verify/upload") => { const f = new FormData(); f.append("file", file); return api(path, { form: f }); };
const deep = (o) => `<ul class="data-list">${Object.entries(o || {}).map(([k, v]) => `<li><span class="data-key">${esc(humanize(k))}</span>: <span class="data-value">${v && typeof v === "object" ? deep(v) : `<b>${esc(v)}</b>`}</span></li>`).join("")}</ul>`;
async function locs(box, set) {
  let pid = ""; box.innerHTML = "";
  const level = async () => {
    const rows = await api("public/locations" + (pid ? "?parentId=" + pid : "")); if (!rows.length) return;
    const s = document.createElement("select"); s.innerHTML = `<option value="">Choose…</option>` + opts(rows.map((r) => [r.id, r.name]));
    s.onchange = async () => { while (s.nextSibling) s.nextSibling.remove(); if (s.value) { set(s.value); pid = s.value; await level(); } };
    box.append(s);
  };
  await level();
}
const phoneStatusNotice = () => `<div class="phone-status-notice" role="status"><span class="phone-status-icon" aria-hidden="true">i</span><div><b>SMS phone verification is temporarily paused</b><p>SMS codes are not being sent right now. You can continue without a verification code; we’ll restore this step when delivery is available.</p></div></div>`;
const navIcon = (route) => {
  const key = route.startsWith("a/") ? route.slice(2) : route;
  return `<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${NAV_ICON_PATHS[key] || NAV_ICON_PATHS.dash}</svg></span>`;
};

function nav() {
  const u = user(), role = u?.role || "", path = (location.hash || "#/").split("?")[0];
  document.body?.classList.toggle("has-sidebar", Boolean(u));
  if (document.body) document.body.dataset.role = u ? String(role).toLowerCase() : "guest";
  const targetFor = (h) => "#/" + h;
  const isActive = (h) => {
    const target = targetFor(h);
    return path === target || path.startsWith(target + "/") || (h === "search" && path === "#/") || (h === "a/overview" && path === "#/a");
  };
  const link = (h, text, kind = "") => `<a class="nav-link ${isActive(h) ? "is-active" : ""} ${kind}" href="${targetFor(h)}"${isActive(h) ? ' aria-current="page"' : ""}>${navIcon(h)}<span class="nav-link-label">${esc(text)}</span></a>`;
  const label = (text) => `<div class="nav-section-label">${esc(text)}</div>`;
  let items = "";
  if (!u) {
    items = label("Explore") + link("search", "Find a home") + label("Your account") + link("login", "Sign in") + link("register", "Get started", "nav-cta");
  } else {
    items = label("Discover") + link("search", "Find a home");
    if (role === "ADMIN") {
      items += label("Admin workspace") + NAV_TABS.map(([key, title]) => link("a/" + key, title)).join("");
    } else {
      items += label("Workspace") + link("dash", "Overview");
      if (role === "TENANT") items += link("tickets", "Maintenance") + link("news", "Notices");
      if (role === "OWNER" || role === "MANAGER") {
        items += link("onboard", "Get verified") + link("tickets", "Maintenance");
        if (role === "OWNER") items += link("pnew", "Add property");
        items += link("unitnew", "Add a unit") + link("announce", "Notices");
        if (role === "OWNER") items += link("insights", "Reports");
      }
    }
    items += label("Account") + link("notes", "Alerts") + `<a class="nav-link nav-signout" href="#/login" data-a="logout">${navIcon("logout")}<span class="nav-link-label">Sign out</span></a>`;
    const displayName = String(u.fullName || u.name || "Account").trim() || "Account";
    items += `<div class="nav-user"><span class="nav-user-avatar">${esc(displayName.slice(0, 1).toUpperCase())}</span><span class="nav-user-copy"><b>${esc(displayName)}</b><small>${esc(humanize(role || "member"))}</small></span></div>`;
  }
  const el = document.getElementById("nav");
  if (el) el.innerHTML = items;
}
// ---------- public pages ----------
EXTRA.home = () => {
  app.innerHTML = `<section class="hero">
    <div class="hero-copy">
      <p class="eyebrow"><span class="eyebrow-dot"></span> A better way to rent in Nigeria</p>
      <h1>Find a home.<br><em>Keep it direct.</em></h1>
      <p>Discover owner-listed homes, speak directly with the people who know them best, and move with confidence. No agents. No viewing fees.</p>
      <form id="hf" class="hero-search">
        <label class="search-field" for="hero-q"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span class="sr-only">Area or city</span><input id="hero-q" name="q" placeholder="Area or city, e.g. Lekki" autocomplete="address-level2"></label>
        <button type="submit">Explore homes <span aria-hidden="true">→</span></button>
      </form>
      <div class="hero-proof"><span><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Verified owners</span><span><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Free viewings</span><span><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Clear pricing</span></div>
    </div>
    <div class="hero-visual" aria-label="A welcoming modern home surrounded by greenery">
      <picture class="hero-picture"><source srcset="assets/hero-residence.webp" type="image/webp"><img class="hero-photo" src="assets/hero-residence.jpg" width="1280" height="853" alt="Modern home with warm natural light and tropical landscaping" fetchpriority="high" decoding="async"></picture>
      <div class="hero-badge"><span class="hero-badge-mark">✓</span><span><strong>Owner-direct</strong><br>Rent with more confidence</span></div>
      <div class="hero-photo-caption"><span>A place to feel at home.</span><span>Direct Homes · Nigeria</span></div>
    </div>
  </section>
  <div class="trust-strip" aria-label="Our promises"><div class="trust-item"><span class="trust-icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 19 6v5c0 4.7-3 8-7 10-4-2-7-5.3-7-10V6l7-3Z" stroke="currentColor" stroke-width="1.7"/><path d="m9 12 2 2 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span> Verified owners and homes</div><div class="trust-item"><span class="trust-icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/><path d="M12 7v5l3.4 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span> View every home for free</div><div class="trust-item"><span class="trust-icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 8.5h16M6.5 5.5h11M6 12h12l-1 7H7l-1-7Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span> Rent goes directly to the owner</div></div>
  <section class="section-block"><div class="section-head"><div><p class="eyebrow"><span class="eyebrow-dot"></span> Simple by design</p><h2>A calmer way to find your next home.</h2></div><p>From the first search to the day you move in, keep every conversation and decision direct, transparent and in one place.</p></div>
    <div class="steps-grid"><article class="step-card"><span class="step-number">01</span><h3>Discover with clarity</h3><p>Browse homes shared by their owners and see the details before you reach out.</p></article><article class="step-card"><span class="step-number">02</span><h3>Meet and view for free</h3><p>Message the owner and arrange a viewing. You never pay an inspection fee.</p></article><article class="step-card"><span class="step-number">03</span><h3>Move in with confidence</h3><p>Use a secure payment token, keep important records together, and get support when you need it.</p></article></div>
  </section>
  <section class="owner-callout"><div><p class="eyebrow">For owners and managers</p><h2>Good homes deserve a more direct way to be found.</h2><p>Get verified, share your listing and manage conversations with less friction.</p></div><a class="button" href="#/register">List your property <span aria-hidden="true">→</span></a></section>`;
  document.getElementById("hf").onsubmit = (e) => { e.preventDefault(); const q = new FormData(e.target).get("q") || ""; location.hash = "#/search?q=" + encodeURIComponent(q); };
};
const legal = (t, body) => (app.innerHTML = `<div class="card"><h2>${t}</h2>${body}<p class="muted">Draft text. Have a Nigerian lawyer review it before launch.</p></div>`);
EXTRA.terms = () => legal("Terms of service", "<p>Direct Homes connects tenants with verified owners and managers. We do not charge tenants and we do not take any part of your rent. Rent is paid by bank transfer directly to the account shown on your approved payment token, using the token code as the narration.</p><p>Owners pay a yearly onboarding fee per property after verification. Listings must be truthful. Fraud leads to removal and a ban. Never pay anyone outside the account shown on your token.</p>");
EXTRA.privacy = () => legal("Privacy notice (NDPA)", "<p>We collect your name, contact details, and for owners, identity documents and bank details, to verify users and run tenancies. Identity documents are stored privately and only admins can view them. Bank account numbers are encrypted. We do not sell your data.</p><p>You may ask to see, correct or delete your data by contacting support. We keep records as long as the law and your tenancy require.</p>");

// ---------- verification and onboarding ----------
EXTRA.verify = () => { app.innerHTML = `<section class="page-heading"><div><p class="eyebrow"><span class="eyebrow-dot"></span> Phone verification</p><h1>SMS codes are paused.</h1><p>You can keep using Direct Homes without a phone verification code for now.</p></div></section>${phoneStatusNotice()}<div class="row"><a class="button" href="#/dash">Back to your dashboard</a></div>`; };
EXTRA.onboard = async () => {
  const [k, acc] = await Promise.all([api("verify/kyc/status").catch(() => ({})), api("accounts").then(arr).catch(() => [])]);
  app.innerHTML = `<h2>Get verified</h2>${phoneStatusNotice()}
  <div class="card"><h3>Identity (KYC)</h3>${kv(k)}<form data-form="kyc" class="col">${L("ID type", `<select name="idType">${opts([["NIN", "NIN"], ["PASSPORT", "Passport"], ["DRIVERS_LICENCE", "Driver's licence"], ["VOTERS_CARD", "Voter's card"]])}</select>`)}${inp("idNumber", "ID number")}${inp("bankAccountName", "Name on your bank account (must match your ID)")}${inp("idDoc", "Photo of your ID", "file", 'accept="image/*,.pdf" required')}${inp("selfie", "Selfie holding your ID", "file", 'accept="image/*" required')}<button>Submit for review</button></form></div>
  <div class="card"><h3>Bank account for receiving rent</h3>${acc.map((a) => kv(a)).join("<hr>")}<form data-form="acct" class="col">${inp("bankName", "Bank")}${inp("accountName", "Account name")}${inp("accountNumber", "10-digit account number", "text", 'pattern="\\d{10}"')}<button>Save account</button></form><p class="muted">Needs an approved KYC. The name must match your verified name.</p></div>`;
};
FORMS.kyc = async (f) => { const [a, b] = await Promise.all([up(f.idDoc), up(f.selfie)]); await api("verify/kyc", { body: { idType: f.idType, idNumber: f.idNumber, idDocumentKey: a.key, selfieKey: b.key, bankAccountName: f.bankAccountName || undefined } }); say("Submitted. We will review it."); EXTRA.onboard(); };
FORMS.acct = async (f) => { await api("accounts", { body: { ...f, isDefault: true } }); say("Saved. It may be reviewed by an admin."); EXTRA.onboard(); };

// ---------- properties and units ----------
EXTRA.pnew = async () => {
  app.innerHTML = `<div class="page-heading"><div><p class="eyebrow"><span class="eyebrow-dot"></span> Owner workspace</p><h1>Add a property</h1><p>Start with the basics. You can add units and documents next.</p></div></div><form data-form="pnew" class="col card">${L("Property type", `<select name="kind">${opts([["HOUSE", "Single house, flat or room"], ["BUILDING", "Building with several units"], ["ESTATE", "Estate I own entirely"]])}</select>`)}${inp("name", "Property name")}${inp("address", "Full address")}<label>Location<div id="lb" class="row"></div></label><input type="hidden" name="locationId" required>${inp("declaredUnits", "Number of units you will list", "number", 'min="1" value="1"')}${inp("estateName", "Estate name (only if your house is in an estate with many owners)")}${L("Description", '<textarea name="description"></textarea>')}<p class="form-note">Please double-check the spelling of names. They appear exactly as typed.</p><button type="submit">Create property <span aria-hidden="true">→</span></button></form>`;
  await locs(document.getElementById("lb"), (id) => (document.querySelector('[name=locationId]').value = id));
};
FORMS.pnew = async (f) => { const b = { ...f, declaredUnits: Number(f.declaredUnits) }; for (const k of ["estateName", "description"]) if (!b[k]) delete b[k]; const p = await api("properties", { body: b }); location.hash = "#/property/" + (p.id || p.property?.id); };
EXTRA.property = async (id) => {
  const p = await api("properties/" + id), mg = p.managers || p.assignments || [], docs = p.documents || [];
  app.innerHTML = `<h2>${esc(p.name)} <span class="tag">${esc(p.status)}</span></h2><div class="card">${kv(p)}<div class="row">${{ DOCS_UPLOADED: btn("submit", id, "Submit for review"), NEEDS_CHANGES: btn("submit", id, "Resubmit"), VERIFIED: btn("payfee", id, "Pay yearly fee"), ACTIVE: btn("renew", id, "Renew early", "g"), EXPIRED: btn("renew", id, "Renew") }[p.status] || ""}<a href="#/propedit/${esc(id)}"><button class="g">Edit</button></a>${btn("delprop", id, "Delete", "r")}${["ACTIVE", "VERIFIED"].includes(p.status) || p.parentId ? `<a href="#/unitnew/${esc(id)}"><button class="g">Add a unit</button></a>` : ""}</div></div>
  <div class="card"><h3>Ownership documents (${docs.length})</h3>${docs.map((d) => `<div class="muted">${esc(d.docType)} · ${esc(d.status)} ${esc(d.reason || "")}</div>`).join("")}<form data-form="pdoc" class="col"><input type="hidden" name="id" value="${esc(id)}">${L("Document", `<select name="docType">${opts([["C_OF_O", "Certificate of Occupancy"], ["GOVERNORS_CONSENT", "Governor's Consent"], ["DEED_OF_ASSIGNMENT", "Deed of Assignment"], ["SURVEY_PLAN", "Survey plan"], ["ALLOCATION_LETTER", "Allocation letter"], ["UTILITY_BILL", "Utility bill (support only)"], ["BUILDING_PHOTO", "Photo of the building front"]])}</select>`)}${inp("file", "File", "file", 'accept="image/*,.pdf" required')}<button>Upload</button></form></div>
  ${p.kind === "ESTATE" ? `<div class="card"><h3>Add a house to this estate</h3><form data-form="house" class="col"><input type="hidden" name="id" value="${esc(id)}">${inp("name", "House name")}${inp("address", "Address")}${inp("declaredUnits", "Units", "number", 'min="1" value="1"')}<button>Add house</button></form></div>` : ""}
  <div class="card"><h3>Managers (${mg.length})</h3>${mg.map((m) => `<div class="row"><span>${esc(m.manager?.fullName || m.fullName || m.managerId)}</span>${btn("rmmgr", id, "Remove", "r", m.managerId || m.manager?.id)}</div>`).join("")}<form data-form="mgr" class="col"><input type="hidden" name="id" value="${esc(id)}">${inp("managerEmail", "Manager's account email", "email")}${inp("file", "Signed authorisation letter", "file", 'accept="image/*,.pdf" required')}${["canListUnits:Can list units", "canSetPrice:Can set rent", "canApproveTokens:Can approve payment tokens", "canReceivePayments:Can receive rent in own account", "canViewPayouts:Can see rent figures"].map((x) => { const [k, t] = x.split(":"); return `<label><input type="checkbox" name="${k}" style="flex:none"> ${t}</label>`; }).join("")}<button>Appoint manager</button></form></div>`;
};
FORMS.pdoc = async (f) => { const k = await up(f.file); await api(`properties/${f.id}/documents`, { body: { docType: f.docType, fileKey: k.key } }); say("Uploaded"); EXTRA.property(f.id); };
FORMS.house = async (f) => { await api(`properties/${f.id}/houses`, { body: { kind: "HOUSE", name: f.name, address: f.address, declaredUnits: Number(f.declaredUnits) } }); say("House added"); EXTRA.property(f.id); };
FORMS.mgr = async (f) => { const k = await up(f.file), b = { managerEmail: f.managerEmail, authorisationKey: k.key }; for (const x of ["canListUnits", "canSetPrice", "canApproveTokens", "canReceivePayments", "canViewPayouts"]) b[x] = !!f[x]; await api(`properties/${f.id}/managers`, { body: b }); say("Manager appointed (pending admin approval of the letter)"); EXTRA.property(f.id); };
EXTRA.unitnew = async (pid) => {
  const m = await api("public/meta");
  app.innerHTML = `<h2>Add a unit</h2><form data-form="unit" class="col card"><input type="hidden" name="propertyId" value="${esc(pid)}">${L("Type", `<select name="unitTypeId">${opts(m.unitTypes.map((t) => [t.id, t.name]))}</select>`)}${inp("title", "Title, e.g. Newly built 2-bedroom flat")}${L("Description", '<textarea name="description"></textarea>')}${inp("rentNaira", "Rent (₦)", "number", 'min="0" required')}${inp("cautionNaira", "Caution fee (₦)", "number", 'min="0" value="0"')}${inp("serviceChargeNaira", "Service charge (₦)", "number", 'min="0" value="0"')}${L("Pay every", `<select name="payDuration">${opts([["ANNUAL", "Year"], ["BIANNUAL", "6 months"], ["QUARTERLY", "3 months"], ["MONTHLY", "Month"]])}</select>`)}${inp("bedrooms", "Bedrooms", "number", 'min="0" value="1"')}${inp("bathrooms", "Bathrooms", "number", 'min="0" value="1"')}${inp("toilets", "Toilets", "number", 'min="0" value="1"')}<label><input type="checkbox" name="furnished" style="flex:none"> Furnished</label><label>Features</label><div class="row">${m.features.map((x) => `<label><input type="checkbox" name="f_${esc(x.id)}" style="flex:none"> ${esc(x.name)}</label>`).join("")}</div>${inp("photos", "Photos (at least 3, up to 15, 5MB each)", "file", 'accept="image/*" multiple required')}<button>Save unit</button></form>`;
};
FORMS.unit = async (f, el) => {
  const files = [...el.photos.files].slice(0, 15), images = []; for (const x of files) images.push((await up(x, "units/images")).url);
  const n = (k) => Number(f[k] || 0), featureIds = [...el.querySelectorAll("[name^=f_]:checked")].map((c) => c.name.slice(2));
  await api("units", { body: { propertyId: f.propertyId, unitTypeId: f.unitTypeId, title: f.title, description: f.description || undefined, rentNaira: n("rentNaira"), cautionNaira: n("cautionNaira"), serviceChargeNaira: n("serviceChargeNaira"), payDuration: f.payDuration, bedrooms: n("bedrooms"), bathrooms: n("bathrooms"), toilets: n("toilets"), furnished: !!f.furnished, featureIds, images } });
  say("Saved as a draft. Publish it from your dashboard."); location.hash = "#/dash";
};

// ---------- tenant pages ----------
EXTRA.token = async (id) => {
  const t = await api("tokens/" + id);
  app.innerHTML = `<div class="card"><h2>Payment token <span class="tag">${esc(t.status)}</span></h2><h3>${esc(t.code || "")}</h3><p>${esc(t.unit?.title || "")}</p>${kv(t)}
  ${t.pay ? `<div class="card" style="background:#e0f2ea"><h3>Pay to</h3><p><b>${esc(t.pay.bankName)}</b><br>${esc(t.pay.accountName)}<br><b style="font-size:22px">${esc(t.pay.accountNumber)}</b><br>Narration: <b>${esc(t.pay.narration)}</b></p><p>Pay before <b>${t.expiresAt ? new Date(t.expiresAt).toLocaleString() : ""}</b></p><p class="muted">${esc(t.warning || "")}</p></div>` : `<p class="muted">Bank details appear here once the owner approves your request.</p>`}
  ${t.status === "ACTIVE" ? `<form data-form="claim" class="col card"><input type="hidden" name="id" value="${esc(id)}"><h3>I have paid</h3>${inp("reference", "Transfer reference or session ID")}${inp("file", "Receipt (optional)", "file", 'accept="image/*,.pdf"')}<button>Tell the owner</button></form>` : ""}
  <div class="row">${t.status === "PAID" ? btn("dl", `tokens/${id}/receipt`, "Download receipt") : ""}${["REQUESTED", "ACTIVE"].includes(t.status) ? btn("tcancel", id, "Cancel request", "g") : ""}${t.status === "PAYMENT_CLAIMED" ? btn("dispute", id, "Owner has not confirmed after 24h? Dispute", "r") : ""}</div></div>`;
};
FORMS.claim = async (f) => { const d = new FormData(); d.append("reference", f.reference || ""); if (f.file?.size) d.append("file", f.file); await api(`tokens/${f.id}/claim`, { form: d }); say("Sent. The owner will confirm."); EXTRA.token(f.id); };
EXTRA.review = (uid) => { app.innerHTML = `<h2>Review your home</h2><form data-form="review" class="col card"><input type="hidden" name="unitId" value="${esc(uid)}">${L("Rating (1-5)", '<input name="rating" type="number" min="1" max="5" required>')}${L("Manager rating (1-5, optional)", '<input name="managerRating" type="number" min="1" max="5">')}${L("Comment", '<textarea name="comment"></textarea>')}<button>Post review</button></form>`; };
FORMS.review = async (f) => { await api("reviews", { body: { unitId: f.unitId, rating: Number(f.rating), managerRating: f.managerRating ? Number(f.managerRating) : undefined, comment: f.comment || undefined } }); say("Thank you"); location.hash = "#/dash"; };
EXTRA.news = async () => { const r = arr(await api("announcements/mine")); app.innerHTML = `<h2>Notices</h2>${r.map((a) => `<div class="card" style="margin:8px 0"><b>${esc(a.title)}</b><p>${esc(a.body)}</p></div>`).join("") || "<p>No notices.</p>"}`; };

// ---------- owner / manager tools ----------
EXTRA.announce = async () => {
  const ps = await api("properties/mine").then(arr).catch(() => []);
  app.innerHTML = `<h2>Notice to tenants</h2><form data-form="ann" class="col card">${L("Property", `<select name="propertyId">${opts(ps.map((p) => [p.id, p.name]))}</select>`)}${inp("title", "Title")}${L("Message", '<textarea name="body" required></textarea>')}<button>Send</button></form>`;
};
FORMS.ann = async (f) => { await api("announcements", { body: f }); say("Sent"); };
EXTRA.insights = async () => { const d = await api("insights/summary"); app.innerHTML = `<h2>Reports</h2><div class="card">${deep(d)}</div><div class="row">${btn("dl", "insights/export/rent.csv", "Download rent CSV", "g")}${btn("dl", "insights/export/tickets.csv", "Download tickets CSV", "g")}</div>`; };

EXTRA.a = () => {
  app.innerHTML = `<section class="error-state" role="alert"><div class="error-mark">!</div><p class="eyebrow">Admin workspace</p><h1>Admin tools could not load.</h1><p>Refresh the page. If this continues, contact your administrator.</p><div class="error-actions"><button type="button" data-retry>Try again</button><a class="button button-secondary" href="#/">Return home</a></div></section>`;
};

// ---------- actions ----------
// ---------- actions ----------
Object.assign(A, {
  rmmgr: async (id, mid) => { await api(`properties/${id}/managers/${mid}`, { method: "DELETE" }); EXTRA.property(id); },
  renewreq: (id) => api("tokens/renew", { body: { tenancyId: id } }).then(() => say("Renewal requested. The owner will review it.")),
  dispute: (id) => api(`tokens/${id}/dispute`, { body: { reason: prompt("What happened?") || "Not confirmed" } }).then(() => EXTRA.token(id)),
  dl: async (path) => { const r = await fetch(API + "/api/" + path, { headers: { Authorization: "Bearer " + localStorage.at } }); if (!r.ok) throw new Error("Download failed"); const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = path.split("/").pop(); a.click(); },
  amed: (id) => api(`admin/tickets/${id}/mediate`, { body: { note: prompt("Note to both sides:") || "Reviewed" } }),
  arep: (id, x) => api(`admin/reports/${id}/resolve`, { body: { action: x, note: prompt("Note:") || "Reviewed" } }),
  ahide: (id) => api(`admin/reviews/${id}/hide`, { body: { hidden: true, reason: prompt("Reason:") || "Policy" } }),
  ares: (id, x) => api(`admin/tokens/${id}/resolve`, { body: { outcome: x, notes: prompt("Notes:") || "Resolved" } }),
  aacc: (id, x) => api(`admin/accounts/${id}/decision`, { body: { decision: x, reason: x === "REJECTED" ? prompt("Reason:") || "Details do not match" : undefined } }),
});
document.addEventListener("submit", async (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  const handler = FORMS[form.dataset.form];
  if (typeof handler !== "function") return;
  e.preventDefault();
  const button = form.querySelector('button[type="submit"], button:not([type])');
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = "Please wait…"; }
  try { await handler(Object.fromEntries(new FormData(form)), form); }
  catch (x) { say(x.message || "Something went wrong. Please try again."); }
  finally { if (button?.isConnected) { button.disabled = false; button.textContent = original; } }
});
