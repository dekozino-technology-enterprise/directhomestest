import "dotenv/config";
// Phase 6 end-to-end test (maintenance, reviews, reports, announcements, analytics). Run: TEST_DATABASE_URL=... npx ts-node tests/phase6.e2e.ts
// Use an EMPTY throwaway database whose name contains "test" (the script creates users and data). Run `npx prisma migrate deploy` on it first.
process.env.PORT = "4101"; process.env.NODE_ENV = "development";
if (!/test/i.test(process.env.TEST_DATABASE_URL ?? "")) { console.error("Set TEST_DATABASE_URL to an EMPTY throwaway database whose name contains \"test\"."); process.exit(2); }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
process.env.DATA_ENC_KEY = "a".repeat(64);
process.env.REPORT_HIDE_THRESHOLD = "3";
import bcrypt from "bcryptjs";
import fs from "fs";
import { prisma } from "../src/lib/prisma";
import "../src/server";
import { runTicketJob } from "../src/jobs/tickets";

const B = "http://localhost:4101/api";
let pass = 0, fail = 0;
const ok = (c: any, m: string) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗ FAIL:", m); } };
async function call(method: string, p: string, tok?: string, body?: any, form?: FormData) {
  const r = await fetch(B + p, { method, headers: { ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const ct = r.headers.get("content-type") ?? "";
  return { s: r.status, j: ct.includes("json") ? await r.json() : null, text: ct.includes("csv") ? await r.text() : null, bytes: ct.includes("image") ? (await r.arrayBuffer()).byteLength : null };
}
async function reg(role: string, name: string, n: number) {
  const r = await call("POST", "/auth/register", undefined, { role, fullName: name, email: `${role.toLowerCase()}${n}@t.com`, phone: `0803000000${n}`, password: "Password123!" });
  if (r.s !== 201) throw new Error("register failed " + JSON.stringify(r.j));
  return { id: r.j.user.id as string, tok: r.j.accessToken as string };
}
const DAY = 86_400_000;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const photo = () => { const f = new FormData(); f.append("file", new Blob([PNG], { type: "image/png" }), "a.png"); return f; };

async function main() {
  await new Promise((r) => setTimeout(r, 1500));
  console.log("\n— SETUP");
  const owner = await reg("OWNER", "Chinedu Okafor", 1), mgr = await reg("MANAGER", "Ada Eze", 2), t1 = await reg("TENANT", "Ngozi Bello", 3), t2 = await reg("TENANT", "Tunde Ade", 4), t3 = await reg("TENANT", "Sade Obi", 5), t4 = await reg("TENANT", "Kunle Ojo", 6), other = await reg("OWNER", "Other Owner", 7);
  await prisma.user.create({ data: { role: "ADMIN", fullName: "Admin", email: "admin@t.com", phone: "08000000000", passwordHash: await bcrypt.hash("Password123!", 4), emailVerified: true, phoneVerified: true } });
  const adminTok = (await call("POST", "/auth/login", undefined, { email: "admin@t.com", password: "Password123!" })).j.accessToken;
  for (const [u, h] of [[owner, "h1"], [other, "h3"]] as const) await prisma.kycRecord.create({ data: { userId: u.id, idType: "NIN", idNumberHash: h, idDocumentUrl: "x", selfieUrl: "y", status: "VERIFIED" } });
  const lagos = await prisma.location.create({ data: { name: "Lagos", level: "STATE" } });
  const ajah = await prisma.location.create({ data: { name: "Ajah", level: "AREA", parentId: lagos.id } });
  const ut = await prisma.unitType.create({ data: { name: "Self-Contain" } });
  const tier = await prisma.onboardingFeeTier.create({ data: { name: "t", kind: "HOUSE", amountNaira: 10 } });
  const prop = await prisma.property.create({ data: { kind: "BUILDING", name: "Palm Court", address: "1 Palm St", locationId: ajah.id, ownerId: owner.id, status: "ACTIVE", declaredUnits: 10 } });
  await prisma.propertyOnboarding.create({ data: { propertyId: prop.id, tierId: tier.id, amountNaira: 10, paidAt: new Date(), startsAt: new Date(), expiresAt: new Date(Date.now() + 300 * DAY), graceEndsAt: new Date(Date.now() + 314 * DAY) } });
  await prisma.managerAssignment.create({ data: { propertyId: prop.id, managerId: mgr.id } }); // no canViewPayouts
  const mk = (title: string, status: "AVAILABLE" | "OCCUPIED") => prisma.unit.create({ data: { propertyId: prop.id, unitTypeId: ut.id, title, rentNaira: 50_000, status, images: { create: [1, 2, 3].map((i) => ({ url: `/media/a${i}.jpg`, sortOrder: i })) } } });
  const uA = await mk("Unit A", "OCCUPIED"), uB = await mk("Unit B", "AVAILABLE");
  const ten = await prisma.tenancy.create({ data: { unitId: uA.id, tenantId: t1.id, rentNaira: 50_000, startsAt: new Date(), endsAt: new Date(Date.now() + 300 * DAY) } });

  console.log("\n— RAISING TICKETS");
  let r = await call("POST", "/tickets", t2.tok, { unitId: uA.id, category: "PLUMBING", title: "Leaking tap", description: "Kitchen tap drips" });
  ok(r.s === 403, "tenant without a tenancy on the unit cannot raise a ticket");
  r = await call("POST", "/tickets", t1.tok, { unitId: uA.id, category: "PLUMBING", title: "x", description: "bad" });
  ok(r.s === 400, "short title is rejected");
  r = await call("POST", "/tickets", owner.tok, { unitId: uA.id, category: "PLUMBING", title: "Leaking tap", description: "Kitchen tap drips" });
  ok(r.s === 403, "owner cannot raise a tenant ticket");
  r = await call("POST", "/tickets", t1.tok, { unitId: uA.id, category: "PLUMBING", title: "Leaking tap", description: "Kitchen tap drips all night", urgency: "HIGH" });
  ok(r.s === 201 && r.j.status === "OPEN", "tenant raises a ticket");
  const tk = r.j.id;
  ok((await prisma.notification.count({ where: { userId: { in: [owner.id, mgr.id] }, type: "TICKET" } })) === 2, "owner and manager are notified");
  r = await call("GET", "/tickets/" + tk, t2.tok);
  ok(r.s === 404, "another tenant cannot open it");
  r = await call("GET", "/tickets/" + tk, other.tok);
  ok(r.s === 404, "an unrelated owner cannot open it");
  r = await call("GET", "/tickets/staff", other.tok);
  ok(r.s === 200 && r.j.total === 0, "an unrelated owner's list is empty");
  r = await call("GET", "/tickets/staff?status=active", mgr.tok);
  ok(r.s === 200 && r.j.total === 1 && r.j.items[0].id === tk, "assigned manager sees it in the staff list");

  console.log("\n— FILES");
  let f = await call("POST", `/tickets/${tk}/files`, t1.tok, undefined, photo());
  ok(f.s === 201 && f.j.phase === "BEFORE", "tenant uploads a photo (phase BEFORE)");
  const fileUrl = f.j.url.replace("/api", "");
  r = await call("GET", fileUrl, t1.tok); ok(r.s === 200 && r.bytes! > 0, "tenant can open the photo");
  r = await call("GET", fileUrl, mgr.tok); ok(r.s === 200, "manager can open the photo");
  r = await call("GET", fileUrl, t2.tok); ok(r.s === 404, "another tenant cannot open it");
  r = await call("GET", fileUrl); ok(r.s === 401, "no login, no photo");
  const bad = new FormData(); bad.append("file", new Blob(["hi"], { type: "text/plain" }), "a.txt");
  r = await call("POST", `/tickets/${tk}/files`, t1.tok, undefined, bad); ok(r.s === 400, "non-image file rejected");
  f = await call("POST", `/tickets/${tk}/files`, mgr.tok, undefined, (() => { const x = photo(); x.append("phase", "AFTER"); return x; })());
  ok(f.s === 201 && f.j.phase === "AFTER", "staff can add an AFTER photo");

  console.log("\n— WORKING THE TICKET");
  r = await call("POST", `/tickets/${tk}/status`, t1.tok, { status: "RESOLVED" }); ok(r.s === 403, "tenant cannot set status");
  r = await call("POST", `/tickets/${tk}/status`, other.tok, { status: "ACKNOWLEDGED" }); ok(r.s === 404, "unrelated owner cannot set status");
  r = await call("POST", `/tickets/${tk}/status`, mgr.tok, { status: "ACKNOWLEDGED", note: "We are sending a plumber" }); ok(r.s === 200, "manager acknowledges");
  r = await call("POST", `/tickets/${tk}/status`, mgr.tok, { status: "ACKNOWLEDGED" }); ok(r.s === 409, "cannot acknowledge twice");
  r = await call("POST", `/vendors`, mgr.tok, { propertyId: prop.id, name: "Emeka Plumbing", trade: "Plumber", phone: "08031112222" });
  ok(r.s === 201, "manager adds a vendor"); const vendor = r.j.id;
  r = await call("GET", `/vendors`, other.tok); ok(r.s === 200 && r.j.length === 0, "other owner does not see the vendor");
  r = await call("PATCH", `/tickets/${tk}`, mgr.tok, { vendorId: vendor, estimateNaira: 15000 }); ok(r.s === 200, "vendor and estimate set");
  const foreign = await call("POST", `/vendors`, other.tok, { propertyId: prop.id, name: "Bad", trade: "x1", phone: "0803" });
  ok(foreign.s === 404, "other owner cannot add vendors to this property");
  r = await call("POST", `/tickets/${tk}/comments`, mgr.tok, { body: "Check the pipe under the sink", internal: true }); ok(r.s === 201, "internal note added");
  r = await call("POST", `/tickets/${tk}/comments`, t1.tok, { body: "Thank you, please hurry", internal: true }); ok(r.s === 201, "tenant comment added");
  r = await call("GET", "/tickets/" + tk, t1.tok);
  ok(r.j.comments.every((c: any) => !c.internal) && r.j.comments.length === 2, "tenant never sees internal notes");
  ok(r.j.estimateNaira === undefined && r.j.costNaira === undefined && r.j.vendor.phone === undefined, "tenant does not see costs or vendor phone");
  r = await call("GET", "/tickets/" + tk, owner.tok);
  ok(r.j.comments.length === 3 && r.j.estimateNaira === 15_000 && r.j.vendor.name === "Emeka Plumbing", "owner sees internal notes, estimate and vendor");
  r = await call("POST", `/tickets/${tk}/status`, mgr.tok, { status: "IN_PROGRESS" }); ok(r.s === 200, "manager moves to in progress");
  r = await call("PATCH", `/tickets/${tk}`, mgr.tok, { costNaira: 12500 }); ok(r.s === 200, "final cost recorded");
  r = await call("POST", `/tickets/${tk}/status`, mgr.tok, { status: "RESOLVED" }); ok(r.s === 200, "manager marks resolved");
  r = await call("POST", `/tickets/${tk}/status`, mgr.tok, { status: "IN_PROGRESS" }); ok(r.s === 409, "a resolved ticket cannot be pushed back by staff");

  console.log("\n— TENANT CONFIRMS OR REOPENS");
  r = await call("POST", `/tickets/${tk}/reopen`, t1.tok, { reason: "x" }); ok(r.s === 400, "reopen needs a reason");
  r = await call("POST", `/tickets/${tk}/reopen`, t1.tok, { reason: "Still dripping this morning" }); ok(r.s === 200 && r.j.status === "REOPENED", "tenant reopens");
  let row = await prisma.maintenanceTicket.findUnique({ where: { id: tk } });
  ok(row!.reopenedCount === 1 && row!.resolvedAt === null, "reopen is counted and resolved date cleared");
  await call("POST", `/tickets/${tk}/status`, mgr.tok, { status: "RESOLVED" });
  r = await call("POST", `/tickets/${tk}/confirm`, t2.tok); ok(r.s === 404, "another tenant cannot confirm");
  r = await call("POST", `/tickets/${tk}/confirm`, t1.tok); ok(r.s === 200 && r.j.status === "CLOSED", "tenant confirms, ticket closed");
  r = await call("POST", `/tickets/${tk}/comments`, t1.tok, { body: "more" }); ok(r.s === 409, "closed ticket takes no comments");
  r = await call("POST", `/tickets/${tk}/reopen`, t1.tok, { reason: "It came back again" }); ok(r.s === 200, "can reopen within 7 days of closing");
  await prisma.maintenanceTicket.update({ where: { id: tk }, data: { status: "CLOSED", closedAt: new Date(Date.now() - 8 * DAY) } });
  r = await call("POST", `/tickets/${tk}/reopen`, t1.tok, { reason: "Much later problem" }); ok(r.s === 409, "cannot reopen after 7 days");

  console.log("\n— SLA ESCALATION AND AUTO-CLOSE");
  const old = await prisma.maintenanceTicket.create({ data: { unitId: uA.id, tenantId: t1.id, category: "ELECTRICAL", title: "No power in kitchen", description: "Sockets dead", urgency: "MEDIUM", slaStartAt: new Date(Date.now() - 8 * DAY) } });
  const fresh = await prisma.maintenanceTicket.create({ data: { unitId: uA.id, tenantId: t1.id, category: "OTHER", title: "Squeaky door", description: "Front door squeaks", urgency: "LOW" } });
  const stale = await prisma.maintenanceTicket.create({ data: { unitId: uA.id, tenantId: t1.id, category: "OTHER", title: "Gate latch", description: "Latch loose", status: "RESOLVED", resolvedAt: new Date(Date.now() - 8 * DAY) } });
  await runTicketJob(); await runTicketJob();
  ok((await prisma.maintenanceTicket.findUnique({ where: { id: old.id } }))!.escalated === true, "ticket past its SLA is escalated");
  ok((await prisma.maintenanceTicket.findUnique({ where: { id: fresh.id } }))!.escalated === false, "a fresh ticket is not");
  ok((await prisma.notification.count({ where: { type: "TICKET", title: "Maintenance ticket escalated" } })) === 1, "admin notified once across two job runs");
  ok((await prisma.maintenanceTicket.findUnique({ where: { id: stale.id } }))!.status === "CLOSED", "resolved ticket nobody answered is auto-closed");
  r = await call("GET", "/admin/tickets", adminTok); ok(r.s === 200 && r.j.items.some((t: any) => t.id === old.id), "admin sees the escalated ticket");
  r = await call("GET", "/admin/tickets", owner.tok); ok(r.s === 403, "owner cannot use the admin queue");
  r = await call("POST", `/admin/tickets/${old.id}/mediate`, adminTok, { note: "Please send an electrician today", forceStatus: "ACKNOWLEDGED" });
  ok(r.s === 200 && (await prisma.maintenanceTicket.findUnique({ where: { id: old.id } }))!.escalated === false, "admin mediates and the escalation clears");
  ok((await prisma.auditLog.count({ where: { action: "TICKET_MEDIATE" } })) === 1, "mediation is audited");

  console.log("\n— REVIEWS");
  r = await call("POST", "/reviews", t2.tok, { unitId: uA.id, rating: 5 }); ok(r.s === 403, "a stranger cannot review");
  r = await call("POST", "/reviews", t1.tok, { unitId: uA.id, rating: 5 }); ok(r.s === 403, "a tenant who has not confirmed move-in cannot review");
  await prisma.tenancy.update({ where: { id: ten.id }, data: { moveInConfirmedAt: new Date() } });
  r = await call("POST", "/reviews", t1.tok, { unitId: uA.id, rating: 9 }); ok(r.s === 400, "rating must be 1-5");
  r = await call("POST", "/reviews", t1.tok, { unitId: uA.id, rating: 4, managerRating: 5, comment: "Good place, quick repairs" });
  ok(r.s === 201, "tenant reviews after move-in");
  r = await call("POST", "/reviews", t1.tok, { unitId: uA.id, rating: 3, comment: "Good place, quick repairs" }); ok(r.s === 200 && r.j.updated, "a second submit updates instead of duplicating");
  await prisma.viewing.create({ data: { unitId: uB.id, tenantId: t2.id, proposedAt: new Date(), status: "COMPLETED" } });
  r = await call("POST", "/reviews", t2.tok, { unitId: uB.id, rating: 5, comment: "Nice rooms" }); ok(r.s === 201, "a completed viewing allows a review");
  ok((await prisma.review.findFirst({ where: { userId: t2.id } }))!.verifiedStay === false, "viewing reviews are not marked verified stay");
  r = await call("GET", `/reviews/unit/${uA.id}`);
  ok(r.s === 200 && r.j.count === 1 && r.j.average === 3 && r.j.reviews[0].by === "Ngozi B.", "public summary shows average and a shortened name");
  ok(!JSON.stringify(r.j).includes("t.com") && !JSON.stringify(r.j).includes("0803"), "no contact details in public reviews");
  const revId = r.j.reviews[0].id;
  r = await call("POST", `/reviews/${revId}/reply`, other.tok, { reply: "Thanks!" }); ok(r.s === 404, "an unrelated owner cannot reply");
  r = await call("POST", `/reviews/${revId}/reply`, owner.tok, { reply: "Thank you Ngozi" }); ok(r.s === 200, "owner replies");
  r = await call("POST", `/admin/reviews/${revId}/hide`, adminTok, { hidden: true }); ok(r.s === 400, "hiding needs a reason");
  r = await call("POST", `/admin/reviews/${revId}/hide`, adminTok, { hidden: true, reason: "Abusive language" }); ok(r.s === 200, "admin hides a review");
  r = await call("GET", `/reviews/unit/${uA.id}`); ok(r.j.count === 0, "hidden review disappears from public view");

  console.log("\n— REPORTING A LISTING");
  r = await call("POST", "/reports", owner.tok, { unitId: uB.id, reason: "SCAM_OR_FRAUD" }); ok(r.s === 403, "owner cannot report their own listing");
  r = await call("POST", "/reports", t1.tok, { unitId: uB.id, reason: "NONSENSE" }); ok(r.s === 400, "unknown reason rejected");
  r = await call("POST", "/reports", t1.tok, { unitId: uB.id, reason: "WRONG_PRICE", details: "Asked for more than listed" }); ok(r.s === 201, "first report accepted");
  r = await call("POST", "/reports", t1.tok, { unitId: uB.id, reason: "WRONG_PRICE" }); ok(r.s === 409, "same person cannot report twice");
  r = await call("GET", `/public/units/${uB.id}`); ok(r.s === 200, "still visible after 1 report");
  await call("POST", "/reports", t2.tok, { unitId: uB.id, reason: "FAKE_LISTING" });
  r = await call("GET", `/public/units/${uB.id}`); ok(r.s === 200, "still visible after 2 reports");
  await call("POST", "/reports", t3.tok, { unitId: uB.id, reason: "SCAM_OR_FRAUD" });
  r = await call("GET", `/public/units/${uB.id}`); ok(r.s === 404, "hidden from search after 3 separate reports");
  r = await call("GET", `/public/units?locationId=${lagos.id}`); ok(r.j.results.every((x: any) => x.id !== uB.id), "also missing from search results");
  r = await call("POST", "/enquiries", t4.tok, { unitId: uB.id, message: "Is it free?" }); ok(r.s === 404, "cannot enquire about a hidden listing");
  r = await call("GET", "/admin/reports", adminTok); ok(r.j[0].unitId === uB.id && r.j[0].reportCount === 3 && r.j[0].hiddenFromSearch, "admin queue lists it first");
  r = await call("POST", `/admin/reports/${uB.id}/resolve`, adminTok, { action: "DISMISS", note: "Price is correct" });
  ok(r.s === 200, "admin dismisses");
  r = await call("GET", `/public/units/${uB.id}`); ok(r.s === 200, "listing is back in search");
  r = await call("POST", `/admin/reports/${uB.id}/resolve`, adminTok, { action: "DISMISS", note: "again" }); ok(r.s === 404, "nothing left to resolve");

  console.log("\n— ANNOUNCEMENTS");
  r = await call("POST", "/announcements", t1.tok, { propertyId: prop.id, title: "Hello", body: "Hello all" }); ok(r.s === 403, "tenants cannot post");
  r = await call("POST", "/announcements", other.tok, { propertyId: prop.id, title: "Hello", body: "Hello all" }); ok(r.s === 404, "unrelated owner cannot post");
  r = await call("POST", "/announcements", mgr.tok, { propertyId: prop.id, title: "Water shut-off", body: "No water on Friday 9am to 2pm" });
  ok(r.s === 201 && r.j.sentTo === 1, "manager posts; the one active tenant is notified");
  r = await call("GET", "/announcements/mine", t1.tok); ok(r.j.length === 1 && r.j[0].title === "Water shut-off", "tenant sees it");
  r = await call("GET", "/announcements/mine", t2.tok); ok(r.j.length === 0, "a non-resident does not");

  console.log("\n— NOTIFICATIONS");
  r = await call("GET", "/dashboard/notifications?unread=true", t1.tok); ok(r.s === 200 && r.j.unread > 0 && r.j.items.every((n: any) => !n.readAt), "unread filter works");
  const nid = r.j.items[0].id;
  r = await call("DELETE", "/dashboard/notifications/" + nid, t2.tok); ok(r.s === 404, "cannot delete someone else's notification");
  r = await call("DELETE", "/dashboard/notifications/" + nid, t1.tok); ok(r.s === 200, "can delete your own");
  r = await call("GET", "/dashboard/staff", owner.tok); ok(r.j.openTickets >= 1, "staff dashboard shows open tickets");

  console.log("\n— REPORTS FOR OWNERS");
  r = await call("GET", "/insights/summary", owner.tok);
  ok(r.s === 200 && r.j.maintenance.totalCostNaira === 12_500 && r.j.occupancyRate === 50, "owner summary: cost total and occupancy");
  ok(r.j.rent !== null, "owner sees rent section");
  r = await call("GET", "/insights/summary", mgr.tok); ok(r.s === 200 && r.j.rent === null, "manager without payout rights sees no rent figures");
  r = await call("GET", "/insights/export/rent.csv", mgr.tok); ok(r.s === 403, "manager cannot export rent");
  r = await call("GET", "/insights/export/tickets.csv", owner.tok); ok(r.s === 200 && r.text!.startsWith("created_at,property"), "owner exports tickets as CSV");
  r = await call("GET", "/insights/summary", t1.tok); ok(r.s === 403, "tenants cannot open owner reports");

  console.log("\n— ADMIN ANALYTICS");
  r = await call("GET", "/admin/analytics/overview", adminTok);
  ok(r.s === 200 && r.j.users.TENANT.ACTIVE === 4 && r.j.units.OCCUPIED === 1 && r.j.units.AVAILABLE === 1, "overview counts users and units");
  ok(r.j.occupancyRate === 50 && typeof r.j.tickets.open === "number", "overview has occupancy and ticket numbers");
  r = await call("GET", "/admin/analytics/by-state", adminTok); ok(r.s === 200 && r.j.Lagos?.properties === 1 && r.j.Lagos.units.OCCUPIED === 1, "by-state rolls Ajah up into Lagos");
  r = await call("GET", "/admin/analytics/overview", owner.tok); ok(r.s === 403, "owner cannot see platform analytics");
  r = await call("GET", "/admin/export/tickets.csv", adminTok); ok(r.s === 200 && r.text!.includes("Palm Court"), "admin exports tickets");
  r = await call("GET", "/admin/export/secrets.csv", adminTok); ok(r.s === 404, "unknown export rejected");
  ok((await prisma.auditLog.count({ where: { action: "EXPORT_CSV" } })) === 1, "export is audited");
  await prisma.ticketComment.create({ data: { ticketId: fresh.id, authorId: t1.id, body: "=HYPERLINK(\"http://evil\")" } });
  await prisma.maintenanceTicket.update({ where: { id: fresh.id }, data: { category: "=cmd|' /C calc'!A0" } });
  r = await call("GET", "/admin/export/tickets.csv", adminTok); ok(!r.text!.split("\n").some((l) => /(^|,)=/.test(l)), "CSV cells that start with = are neutralised");

  console.log(`\n${pass} passed, ${fail} failed`);
  fs.readdirSync("private-uploads").filter((n) => n.includes("-tk-")).forEach((n) => fs.unlinkSync("private-uploads/" + n));
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
