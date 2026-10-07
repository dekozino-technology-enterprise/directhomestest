// Landlord-owned tenancy agreements: write once, edit any time, add a logo, issue to chosen tenants.
NAV_ICON_PATHS.agreements = '<path d="M7 3.5h8l4 4V20.5H7z"/><path d="M15 3.5v4h4M10 12h6M10 15.5h6"/>';
const AG_FIELDS = [["tenant_name", "Tenant name"], ["tenant_email", "Tenant email"], ["tenant_phone", "Tenant phone"], ["landlord_name", "Landlord name"], ["landlord_phone", "Landlord phone"], ["property_name", "Property"], ["unit_title", "Unit"], ["address", "Address"], ["rent", "Rent"], ["caution", "Caution fee"], ["service_charge", "Service charge"], ["total", "Total paid"], ["pay_period", "Rent period"], ["start_date", "Start date"], ["end_date", "End date"], ["receipt_no", "Receipt no"], ["today", "Today's date"]];
const AG_STARTER = `# TENANCY AGREEMENT
This agreement is made on {{today}} between {{landlord_name}} (the Landlord) and {{tenant_name}} (the Tenant).

# 1. The premises
The Landlord lets and the Tenant takes {{unit_title}} at {{property_name}}, {{address}}.

# 2. Term
The tenancy runs from {{start_date}} to {{end_date}}.

# 3. Rent and deposits
The Tenant has paid rent of {{rent}} per {{pay_period}}, a caution deposit of {{caution}} and a service charge of {{service_charge}}. Total paid: {{total}} (receipt {{receipt_no}}).

# 4. The Tenant agrees to
Pay rent on or before the due date, keep the premises in good condition, not sublet without the Landlord's written consent, and report faults promptly.

# 5. The Landlord agrees to
Allow quiet enjoyment of the premises, carry out major repairs, and return the caution deposit at the end of the tenancy after deducting only proven damage or unpaid sums.

# 6. Ending the tenancy
Either party must give notice as required by the tenancy law of the state where the premises are located.`;

EXTRA.agreements = async () => {
  const owner = user().role === "OWNER";
  const [tpls, tn] = await Promise.all([api("agreements/templates").then(arr).catch(() => []), api("tenancies/mine").then(arr).catch(() => [])]);
  const rows = tn.filter((t) => t.active !== false);
  app.innerHTML = `<h2>Tenancy agreements</h2><p class="muted">Write your own agreement, then issue it to the tenants you choose once their payment is confirmed. Their name, rent, dates and other details are filled in automatically, and your logo appears on the agreement and on receipts.</p>
  <div class="card"><h3>Issue to tenants</h3>${!tpls.length ? "<p>Create a template first.</p>" : `<label>Template<select id="agt">${opts(tpls.map((t) => [t.id, t.name + (t.isDefault ? " (default)" : "")]))}</select></label>
  ${rows.map((t) => `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="agsel" value="${esc(t.id)}" style="flex:none" ${t.issued ? "" : "checked"}> <span><b>${esc(t.tenant?.fullName || "Tenant")}</b> · ${esc(t.unit?.title || "")} <span class="tag">${t.issued ? "issued" : "not issued"}</span></span></label>`).join("") || '<p class="muted">No tenancies yet. They appear here after a payment is confirmed.</p>'}
  ${rows.length ? `<div class="row">${btn("agissue", "", "Issue to selected")}</div>` : ""}`}</div>
  <h3>Your templates</h3>${owner ? `<p><a href="#/agreement/new"><button>New template</button></a></p>` : ""}
  <div class="grid">${tpls.map((t) => `<div class="card"><b>${esc(t.name)}</b> ${t.isDefault ? '<span class="tag">default</span>' : ""}${t.hasLogo ? `<div data-logo="${esc(t.id)}" style="max-width:150px"></div>` : '<p class="muted">No logo</p>'}<div class="row">${owner ? `<a href="#/agreement/${esc(t.id)}"><button class="g">Edit</button></a>` : ""}${btn("agpdf", t.id, "Preview PDF", "g")}${owner ? btn("agdel", t.id, "Delete", "r") : ""}</div></div>`).join("") || "<p class='muted'>No templates yet.</p>"}</div>`;
  document.querySelectorAll("[data-logo]").forEach((b) => authMedia(b, `/api/agreements/templates/${b.dataset.logo}/logo`));
};
EXTRA.agreement = async (id) => {
  const t = id === "new" ? { name: "", body: AG_STARTER, isDefault: false } : (await api("agreements/templates").then(arr)).find((x) => x.id === id);
  if (!t) return (app.innerHTML = '<p class="card">Template not found.</p>');
  app.innerHTML = `<p><a href="#/agreements">← Back</a></p><h2>${id === "new" ? "New agreement template" : "Edit template"}</h2>
  <form data-form="agtpl" class="col card"><input type="hidden" name="id" value="${id === "new" ? "" : esc(id)}">${inp("name", "Template name, e.g. Standard 1-year tenancy", "text", `required value="${esc(t.name)}"`)}
  ${t.hasLogo ? `<label>Current logo</label><div data-logo="${esc(id)}" style="max-width:160px"></div><label><input type="checkbox" name="rmlogo" style="flex:none"> Remove logo</label>` : ""}
  ${inp("logo", "Logo (PNG or JPG, up to 5MB). It also appears on payment receipts.", "file", 'accept="image/png,image/jpeg"')}
  <label><input type="checkbox" name="isDefault" style="flex:none" ${t.isDefault ? "checked" : ""}> Use as my default (its logo is used on receipts)</label>
  <label>Agreement text. Start a line with # for a heading. Insert details that fill in automatically:</label><div class="chips">${AG_FIELDS.map(([k, l]) => btn("aginsert", k, l, "g")).join("")}</div>
  <textarea id="agbody" name="body" class="mono" required>${esc(t.body)}</textarea>
  <div class="row"><button>Save template</button>${id !== "new" ? btn("agpdf", id, "Preview PDF", "g") : ""}</div><p class="muted">This is your own agreement text. Have a lawyer review it.</p></form>`;
  document.querySelectorAll("[data-logo]").forEach((b) => authMedia(b, `/api/agreements/templates/${b.dataset.logo}/logo`));
};
FORMS.agtpl = async (f) => {
  const body = { name: f.name, body: f.body, isDefault: !!f.isDefault };
  if (f.logo?.size) body.logoKey = (await up(f.logo)).key; else if (f.rmlogo) body.logoKey = null;
  if (f.id) await api("agreements/templates/" + f.id, { method: "PATCH", body }); else await api("agreements/templates", { body });
  say("Template saved"); location.hash = "#/agreements";
};
Object.assign(A, {
  aginsert: (_, k) => { const ta = document.getElementById("agbody"), s = ta.selectionStart, v = `{{${k}}}`; ta.setRangeText(v, s, ta.selectionEnd, "end"); ta.focus(); },
  agpdf: async (id) => { const r = await fetch(API + `/api/agreements/templates/${id}/preview`, { headers: { Authorization: "Bearer " + localStorage.at } }); if (!r.ok) throw new Error("Could not open the preview"); const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.target = "_blank"; a.click(); },
  agdel: (id) => go("Delete this template? Agreements already issued are not affected.", [], () => api("agreements/templates/" + id, { method: "DELETE" }).then(() => EXTRA.agreements()), "Delete"),
  agissue: async () => { const ids = [...document.querySelectorAll(".agsel:checked")].map((c) => c.value); if (!ids.length) throw new Error("Tick at least one tenant"); const d = await api("agreements/issue", { body: { templateId: document.getElementById("agt").value, tenancyIds: ids } }); say(`Issued to ${d.issued} tenant(s)` + (d.skipped.length ? `, ${d.skipped.length} skipped` : "")); EXTRA.agreements(); },
});
route();
