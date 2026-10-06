// Phase 9: modal forms (replace pop-up prompts), unit/property edit and delete, ticket page with photos
function ask(title, fields = [], ok = "Submit") {
  return new Promise((res) => {
    const d = document.createElement("dialog"), fh = (f) => {
      const a = `name="${f.n}" ${f.req ? "required" : ""} ${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""}`;
      return L(f.l, f.t === "textarea" ? `<textarea ${a}>${esc(f.v || "")}</textarea>` : f.t === "select" ? `<select ${a}>${opts(f.o)}</select>` : f.t === "file" ? `<input type="file" ${a} accept="${f.accept || "image/*"}" ${f.multiple ? "multiple" : ""}>` : `<input type="${f.t || "text"}" ${a} value="${esc(f.v ?? "")}">`);
    };
    d.innerHTML = `<form method="dialog" class="col"><h3>${esc(title)}</h3>${fields.map(fh).join("")}<div class="row"><button value="ok">${esc(ok)}</button><button type="button" class="g" id="x">Cancel</button></div></form>`;
    let v = null; const f = d.querySelector("form");
    f.addEventListener("submit", () => { v = Object.fromEntries(new FormData(f)); for (const x of fields) if (x.t === "file") v[x.n] = [...f.elements[x.n].files]; });
    d.querySelector("#x").onclick = () => d.close("x");
    d.onclose = () => { res(d.returnValue === "ok" ? v : null); d.remove(); };
    document.body.append(d); d.showModal();
  });
}
const go = async (title, fields, fn, ok) => { const v = await ask(title, fields, ok); if (v) await fn(v); };
const T = (n, l) => ({ n, l, t: "textarea", req: 1 });
const iso = (s) => new Date(s).toISOString();
const REPORTS = ["FAKE_LISTING", "ALREADY_RENTED", "WRONG_PRICE", "ASKED_TO_PAY_OFF_PLATFORM", "SCAM_OR_FRAUD", "OTHER"].map((x) => [x, x.replace(/_/g, " ").toLowerCase()]);
const CATS = ["PLUMBING", "ROOFING_LEAKAGE", "ELECTRICAL", "WATER_PUMP", "SANITATION", "SECURITY", "APPLIANCE", "OTHER"].map((x) => [x, x.replace(/_/g, " ").toLowerCase()]);
Object.assign(A, {
  enquire: (id) => need() && go("Message the owner", [T("m", "Your message")], async (v) => { const e = await api("enquiries", { body: { unitId: id, message: v.m } }); location.hash = "#/chat/" + (e.id || e.enquiry?.id); }, "Send"),
  viewing: (id) => need() && go("Book a free viewing", [{ n: "w", l: "Preferred date and time", t: "datetime-local", req: 1 }], async (v) => { await api("viewings", { body: { unitId: id, proposedAt: iso(v.w) } }); say("Viewing requested (free)"); }, "Request"),
  report: (id) => need() && go("Report this listing", [{ n: "r", l: "Reason", t: "select", o: REPORTS }, { n: "d", l: "Details (optional)", t: "textarea" }], async (v) => { await api("reports", { body: { unitId: id, reason: v.r, details: v.d || undefined } }); say("Report sent"); }, "Report"),
  claim: (id) => (location.hash = "#/token/" + id),
  treopen: (id) => go("Reopen ticket", [T("r", "What is still wrong?")], (v) => api(`tickets/${id}/reopen`, { body: { reason: v.r } }), "Reopen"),
  issue: (unitId) => go("Report an issue", [{ n: "c", l: "Category", t: "select", o: CATS }, { n: "t", l: "Short title", req: 1 }, T("d", "Describe the problem"), { n: "u", l: "Urgency", t: "select", o: [["MEDIUM", "Medium"], ["LOW", "Low"], ["HIGH", "High"], ["EMERGENCY", "Emergency"]] }, { n: "p", l: "Photos or video (optional)", t: "file", accept: "image/*,video/mp4", multiple: 1 }], async (v) => {
    const t = await api("tickets", { body: { unitId, category: v.c, title: v.t, description: v.d, urgency: v.u } }), id = t.id || t.ticket?.id;
    for (const f of v.p.slice(0, 12)) await up(f, `tickets/${id}/files`);
    location.hash = "#/ticket/" + id;
  }, "Send"),
  approve: async (id) => { const acc = await api("accounts").then(arr).catch(() => []); await go("Approve payment request", [{ n: "a", l: "Receive into", t: "select", o: acc.length ? acc.map((a) => [a.id, `${a.bankName || "Account"} ${a.last4 ? "…" + a.last4 : ""}`]) : [["", "Default account"]] }, { n: "h", l: "Hold the unit for (hours, 6-120)", t: "number", v: 48, min: 6, max: 120 }], (v) => api(`tokens/${id}/approve`, { body: { accountId: v.a || undefined, hours: Number(v.h) } }), "Approve"); },
  reject: (id) => go("Reject request", [T("r", "Reason")], (v) => api(`tokens/${id}/reject`, { body: { reason: v.r } }), "Reject"),
  confirmpay: (id) => go("Confirm money received", [{ n: "a", l: "Amount received (₦). It must equal the total due.", t: "number", req: 1, min: 1 }], (v) => api(`tokens/${id}/confirm`, { body: { amountKobo: Math.round(Number(v.a) * 100) } }), "Confirm"),
  dispute: (id) => go("Dispute payment", [T("r", "What happened?")], (v) => api(`tokens/${id}/dispute`, { body: { reason: v.r } }).then(() => EXTRA.token(id)), "Dispute"),
  amed: (id) => go("Mediate ticket", [T("n", "Note to both sides")], (v) => api(`admin/tickets/${id}/mediate`, { body: { note: v.n } })),
  arep: (id, x) => go(x === "TAKE_DOWN" ? "Take down listing" : "Dismiss reports", [T("n", "Note")], (v) => api(`admin/reports/${id}/resolve`, { body: { action: x, note: v.n } })),
  ahide: (id) => go("Hide review", [T("r", "Reason")], (v) => api(`admin/reviews/${id}/hide`, { body: { hidden: true, reason: v.r } }), "Hide"),
  ares: (id, x) => go("Resolve dispute", [T("n", "Notes")], (v) => api(`admin/tokens/${id}/resolve`, { body: { outcome: x, notes: v.n } })),
  aacc: (id, x) => x === "APPROVED" ? api(`admin/accounts/${id}/decision`, { body: { decision: x } }) : go("Reject account", [T("r", "Reason")], (v) => api(`admin/accounts/${id}/decision`, { body: { decision: x, reason: v.r } }), "Reject"),
  delunit: (id) => go("Delete this unit? This cannot be undone.", [], () => api("units/" + id, { method: "DELETE" }).then(() => say("Deleted")), "Delete"),
  delprop: (id) => go("Delete this property? This cannot be undone.", [], () => api("properties/" + id, { method: "DELETE" }).then(() => { say("Deleted"); location.hash = "#/dash"; }), "Delete"),
});

// ----- unit create/edit with property picker (works for owners and managers) -----
let UORIG = null;
async function unitPage({ pid, id }) {
  if (!id && !pid) {
    const ps = (await api("properties/mine").then(arr)).filter((p) => p.status !== "REJECTED");
    app.innerHTML = `<h2>Add a unit</h2>${ps.length ? `<form data-form="upick" class="col card">${L("Which property?", `<select name="pid">${opts(ps.map((p) => [p.id, `${p.name} (${p.status})`]))}</select>`)}<button>Continue</button></form>` : "<p>You have no property yet. Owners add one first; managers are assigned by the owner.</p>"}`; return;
  }
  const m = await api("public/meta"); UORIG = id ? await api("units/" + id) : null; const u = UORIG || {}, n = (k, d = 0) => esc(u[k] ?? d);
  app.innerHTML = `<h2>${id ? "Edit unit" : "Add a unit"}</h2><form data-form="unit" class="col card"><input type="hidden" name="uid" value="${esc(id || "")}"><input type="hidden" name="propertyId" value="${esc(pid || u.propertyId)}">
  ${L("Type", `<select name="unitTypeId">${opts(m.unitTypes.map((t) => [t.id, t.name]))}</select>`)}${inp("title", "Title", "text", `value="${esc(u.title || "")}" required`)}${L("Description", `<textarea name="description">${esc(u.description || "")}</textarea>`)}
  ${inp("rentNaira", "Rent (₦)", "number", `min="0" required value="${n("rentNaira")}"`)}${inp("cautionNaira", "Caution fee (₦)", "number", `min="0" value="${n("cautionNaira")}"`)}${inp("serviceChargeNaira", "Service charge (₦)", "number", `min="0" value="${n("serviceChargeNaira")}"`)}
  ${L("Pay every", `<select name="payDuration">${opts([["ANNUAL", "Year"], ["BIANNUAL", "6 months"], ["QUARTERLY", "3 months"], ["MONTHLY", "Month"]])}</select>`)}${inp("bedrooms", "Bedrooms", "number", `min="0" value="${n("bedrooms", 1)}"`)}${inp("bathrooms", "Bathrooms", "number", `min="0" value="${n("bathrooms", 1)}"`)}${inp("toilets", "Toilets", "number", `min="0" value="${n("toilets", 1)}"`)}
  <label><input type="checkbox" name="furnished" style="flex:none" ${u.furnished ? "checked" : ""}> Furnished</label><label>Features</label><div class="row">${m.features.map((x) => `<label><input type="checkbox" name="f_${esc(x.id)}" style="flex:none" ${(u.featureIds || []).includes(x.id) ? "checked" : ""}> ${esc(x.name)}</label>`).join("")}</div>
  ${(u.images || []).length ? `<label>Current photos (untick to remove)</label><div class="row">${u.images.map((i) => `<label><img src="${API}${esc(i)}" style="height:70px"><br><input type="checkbox" name="keep" value="${esc(i)}" checked style="flex:none"></label>`).join("")}</div>` : ""}
  ${inp("photos", id ? "Add more photos" : "Photos (at least 3, up to 15, 5MB each)", "file", `accept="image/*" multiple ${id ? "" : "required"}`)}<button>${id ? "Save changes" : "Save unit"}</button>${id ? btn("delunit", id, "Delete this unit", "r") : ""}</form>`;
  if (u.payDuration) document.querySelector("[name=payDuration]").value = u.payDuration; if (u.unitTypeId) document.querySelector("[name=unitTypeId]").value = u.unitTypeId;
}
EXTRA.unitnew = (pid) => unitPage({ pid });
EXTRA.unitedit = (id) => unitPage({ id });
FORMS.upick = (f) => (location.hash = "#/unitnew/" + f.pid);
FORMS.unit = async (f, el) => {
  const images = [...el.querySelectorAll("[name=keep]:checked")].map((c) => c.value);
  for (const x of [...el.photos.files].slice(0, 15)) images.push((await up(x, "units/images")).url);
  if (images.length > 15) throw new Error("A unit can have up to 15 photos");
  const n = (k) => Number(f[k] || 0), featureIds = [...el.querySelectorAll("[name^=f_]:checked")].map((c) => c.name.slice(2));
  const b = { unitTypeId: f.unitTypeId, title: f.title, description: f.description || undefined, payDuration: f.payDuration, bedrooms: n("bedrooms"), bathrooms: n("bathrooms"), toilets: n("toilets"), furnished: !!f.furnished, featureIds, images };
  for (const k of ["rentNaira", "cautionNaira", "serviceChargeNaira"]) if (!f.uid || n(k) !== UORIG[k]) b[k] = n(k); // managers without price rights only send unchanged-free edits
  if (f.uid) await api("units/" + f.uid, { method: "PATCH", body: b }); else await api("units", { body: { propertyId: f.propertyId, ...b } });
  say(f.uid ? "Saved" : "Saved as a draft. Publish it from your dashboard."); location.hash = "#/dash";
};

// ----- property edit -----
EXTRA.propedit = async (id) => {
  const p = await api("properties/" + id), lock = !["DRAFT", "DOCS_UPLOADED", "NEEDS_CHANGES"].includes(p.status), ro = lock ? "readonly" : "";
  app.innerHTML = `<h2>Edit property</h2><form data-form="pedit" class="col card"><input type="hidden" name="id" value="${esc(id)}">${inp("name", "Name", "text", `value="${esc(p.name)}" ${ro}`)}${inp("address", "Address", "text", `value="${esc(p.address)}" ${ro}`)}${lock ? '<p class="muted">Name and address are locked after review because changing them needs re-verification. Contact support.</p>' : '<p class="muted">Please double-check the spelling.</p>'}${inp("declaredUnits", "Number of units", "number", `min="1" value="${esc(p.declaredUnits)}"`)}${p.kind === "HOUSE" ? inp("estateName", "Estate name (multi-owner estates only)", "text", `value="${esc(p.estateName || "")}"`) : ""}${L("Description", `<textarea name="description">${esc(p.description || "")}</textarea>`)}<button>Save</button></form>`;
  window.PLOCK = lock;
};
FORMS.pedit = async (f) => { const b = { declaredUnits: Number(f.declaredUnits), description: f.description || null }; if ("estateName" in f) b.estateName = f.estateName || null; if (!window.PLOCK) { b.name = f.name; b.address = f.address; } await api("properties/" + f.id, { method: "PATCH", body: b }); say("Saved"); location.hash = "#/property/" + f.id; };

// ----- ticket page: photos, video, comments, status -----
async function authMedia(box, url) {
  const r = await fetch(API + url, { headers: { Authorization: "Bearer " + localStorage.at } });
  if (!r.ok) return (box.textContent = "Unavailable");
  const b = await r.blob(), u = URL.createObjectURL(b);
  box.innerHTML = b.type.startsWith("video") ? `<video controls src="${u}" style="max-width:100%"></video>` : `<img src="${u}" style="max-width:100%;border-radius:8px">`;
}
EXTRA.ticket = async (id) => {
  const t = await api("tickets/" + id), me = user(), staff = me.role !== "TENANT", at = t.attachments || [], cm = t.comments || [];
  app.innerHTML = `<div class="card"><h2>${esc(t.title)} <span class="tag">${esc(t.status)}</span></h2><p>${esc(t.description || "")}</p>${kv(t)}<div class="row">${staff ? ["ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED"].map((s) => btn("tstat", id, s.replace("_", " ").toLowerCase(), "g", s)).join("") : t.status === "RESOLVED" ? btn("tconfirm", id, "Confirm fixed") + btn("treopen", id, "Reopen", "g") : ""}</div></div>
  <h3>Photos and videos (${at.length})</h3><div class="grid">${at.map((a) => `<div class="card"><span class="muted">${esc(a.phase || "")}</span><div data-att="${esc(a.id)}">Loading…</div></div>`).join("")}</div>
  <form data-form="tfile" class="col card"><input type="hidden" name="id" value="${esc(id)}">${inp("file", "Add a photo (JPG, PNG, WEBP up to 5MB) or MP4 (up to 20MB)", "file", 'accept="image/*,video/mp4" required')}${staff ? L("Type", `<select name="phase">${opts([["UPDATE", "Progress update"], ["AFTER", "Completion photo"], ["BEFORE", "Before"]])}</select>`) : ""}<button>Upload</button></form>
  <h3>Comments</h3>${cm.map((c) => `<div class="card" style="margin:6px 0"><span class="muted">${esc(c.author?.fullName || c.authorName || "")} ${c.internal ? "(internal)" : ""}</span><p>${esc(c.body)}</p></div>`).join("") || '<p class="muted">No comments yet.</p>'}
  <form data-form="tcomment" class="col card"><input type="hidden" name="id" value="${esc(id)}">${L("Add a comment", '<textarea name="body" required></textarea>')}${staff ? '<label><input type="checkbox" name="internal" style="flex:none"> Internal note (tenant cannot see)</label>' : ""}<button>Post</button></form>`;
  document.querySelectorAll("[data-att]").forEach((b) => authMedia(b, `/api/tickets/${id}/files/${b.dataset.att}`));
};
FORMS.tfile = async (f) => { const d = new FormData(); d.append("file", f.file); if (f.phase) d.append("phase", f.phase); await api(`tickets/${f.id}/files`, { form: d }); say("Uploaded"); EXTRA.ticket(f.id); };
FORMS.tcomment = async (f) => { await api(`tickets/${f.id}/comments`, { body: { body: f.body, internal: !!f.internal } }); EXTRA.ticket(f.id); };
