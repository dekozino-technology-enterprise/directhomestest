import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { audit } from "../lib/audit";
import { toCsv } from "../lib/csv";
import { totalOf } from "../lib/payToken";
import { requireAuth, requireRole } from "../middleware/auth";

// Admin analytics and CSV exports
const r = Router();
r.use(requireAuth, requireRole("ADMIN"));
const DAY = 86_400_000;
const group = <T extends string>(rows: { k: T; n: number }[]) => Object.fromEntries(rows.map((x) => [x.k, x.n]));

r.get("/analytics/overview", async (_req, res) => {
  const now = new Date(), d30 = new Date(now.getTime() - 30 * DAY), d365 = new Date(now.getTime() - 365 * DAY);
  const [users, props, units, tickets, openReports, flagged, expiring, disputes, onboard, onboard30, byMonth, rentByMonth, resolved] = await Promise.all([
    prisma.user.groupBy({ by: ["role", "status"], _count: { _all: true } }),
    prisma.property.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.unit.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.maintenanceTicket.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.report.count({ where: { status: "OPEN" } }),
    prisma.unit.count({ where: { flaggedAt: { not: null } } }),
    prisma.propertyOnboarding.count({ where: { expiresAt: { gte: now, lt: new Date(now.getTime() + 30 * DAY) } } }),
    prisma.paymentToken.count({ where: { status: "DISPUTED" } }),
    prisma.propertyOnboarding.aggregate({ where: { paidAt: { not: null } }, _sum: { amountNaira: true }, _count: { _all: true } }),
    prisma.propertyOnboarding.aggregate({ where: { paidAt: { gte: d30 } }, _sum: { amountNaira: true } }),
    prisma.$queryRaw<{ m: string; s: bigint }[]>(Prisma.sql`SELECT to_char(date_trunc('month', "paidAt"), 'YYYY-MM') AS m, COALESCE(SUM("amountNaira"), 0)::bigint AS s FROM "PropertyOnboarding" WHERE "paidAt" >= ${d365} GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<{ m: string; s: bigint; c: bigint }[]>(Prisma.sql`SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS m, COALESCE(SUM("amountNaira"), 0)::bigint AS s, COUNT(*)::bigint AS c FROM "Transaction" WHERE purpose IN ('RENT','RENEWAL') AND status = 'SUCCESS' AND "createdAt" >= ${d365} GROUP BY 1 ORDER BY 1`),
    prisma.maintenanceTicket.findMany({ where: { resolvedAt: { not: null }, createdAt: { gte: d365 } }, select: { createdAt: true, resolvedAt: true }, take: 5000 }),
  ]);
  const unitBy = group(units.map((u) => ({ k: u.status, n: u._count._all })));
  const live = (unitBy.AVAILABLE ?? 0) + (unitBy.RESERVED ?? 0) + (unitBy.OCCUPIED ?? 0);
  const hours = resolved.map((t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 3_600_000);
  const tk = group(tickets.map((t) => ({ k: t.status, n: t._count._all })));
  res.json({
    users: users.reduce((o, u) => { (o[u.role] ??= {})[u.status] = u._count._all; return o; }, {} as Record<string, Record<string, number>>),
    properties: group(props.map((p) => ({ k: p.status, n: p._count._all }))),
    units: unitBy,
    occupancyRate: live ? Math.round(((unitBy.OCCUPIED ?? 0) / live) * 1000) / 10 : null, // % of listed units that are occupied
    onboarding: { paidCount: onboard._count._all, totalNaira: onboard._sum.amountNaira ?? 0, last30DaysNaira: onboard30._sum.amountNaira ?? 0, expiringIn30Days: expiring, byMonth: byMonth.map((x) => ({ month: x.m, naira: Number(x.s) })) },
    // Rent is paid straight to landlords. This is the volume the platform has RECORDED as confirmed, not money it holds.
    rentRecorded: rentByMonth.map((x) => ({ month: x.m, naira: Number(x.s), payments: Number(x.c) })),
    tickets: { byStatus: tk, open: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "REOPENED"].reduce((s, k) => s + (tk[k] ?? 0), 0), escalated: await prisma.maintenanceTicket.count({ where: { escalated: true, status: { in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "REOPENED"] } } }), avgResolutionHours: hours.length ? Math.round(hours.reduce((a, b) => a + b, 0) / hours.length) : null },
    openReports, listingsHiddenByReports: flagged, paymentDisputes: disputes,
  });
});

// Properties, units and occupancy per state (walks the location tree up to the STATE)
r.get("/analytics/by-state", async (_req, res) => {
  const locs = await prisma.location.findMany({ select: { id: true, name: true, level: true, parentId: true } });
  const byId = new Map(locs.map((l) => [l.id, l]));
  const stateOf = (id: string) => { let l = byId.get(id), guard = 0; while (l && l.level !== "STATE" && l.parentId && guard++ < 6) l = byId.get(l.parentId); return l?.name ?? "Unknown"; };
  const [pRows, uRows] = await Promise.all([
    prisma.$queryRaw<{ loc: string; n: bigint }[]>(Prisma.sql`SELECT "locationId" AS loc, COUNT(*)::bigint AS n FROM "Property" WHERE status <> 'DRAFT' GROUP BY 1`),
    prisma.$queryRaw<{ loc: string; status: string; n: bigint }[]>(Prisma.sql`SELECT p."locationId" AS loc, u.status::text AS status, COUNT(*)::bigint AS n FROM "Unit" u JOIN "Property" p ON p.id = u."propertyId" GROUP BY 1, 2`),
  ]);
  const out: Record<string, { properties: number; units: Record<string, number>; occupancyRate: number | null }> = {};
  for (const p of pRows) (out[stateOf(p.loc)] ??= { properties: 0, units: {}, occupancyRate: null }).properties += Number(p.n);
  for (const u of uRows) { const s = (out[stateOf(u.loc)] ??= { properties: 0, units: {}, occupancyRate: null }); s.units[u.status] = (s.units[u.status] ?? 0) + Number(u.n); }
  for (const s of Object.values(out)) { const live = (s.units.AVAILABLE ?? 0) + (s.units.RESERVED ?? 0) + (s.units.OCCUPIED ?? 0); s.occupancyRate = live ? Math.round(((s.units.OCCUPIED ?? 0) / live) * 1000) / 10 : null; }
  res.json(out);
});

// Units where the same kind of fault keeps coming back (3+ tickets in the last 12 months)
r.get("/analytics/recurring-issues", async (_req, res) => {
  const rows = await prisma.maintenanceTicket.groupBy({ by: ["unitId", "category"], where: { createdAt: { gte: new Date(Date.now() - 365 * DAY) } }, _count: { _all: true }, having: { id: { _count: { gte: 3 } } }, orderBy: { _count: { id: "desc" } }, take: 50 });
  const units = await prisma.unit.findMany({ where: { id: { in: rows.map((x) => x.unitId) } }, select: { id: true, title: true, property: { select: { name: true } } } });
  const u = new Map(units.map((x) => [x.id, x]));
  res.json(rows.map((x) => ({ unitId: x.unitId, unit: u.get(x.unitId)?.title, property: u.get(x.unitId)?.property.name, category: x.category, tickets: x._count._all })));
});

// ───── CSV exports (each download is recorded in the audit log) ─────
const range = (q: any) => { const f = q.from ? new Date(String(q.from)) : undefined, t = q.to ? new Date(String(q.to)) : undefined; return { ...(f && !isNaN(+f) ? { gte: f } : {}), ...(t && !isNaN(+t) ? { lte: t } : {}) }; };
const LIMIT = 50_000;
r.get("/export/:what.csv", async (req, res) => {
  const what = req.params.what, createdAt = range(req.query), has = Object.keys(createdAt).length ? { createdAt } : {};
  let headers: string[], rows: unknown[][];
  if (what === "onboarding") {
    const x = await prisma.propertyOnboarding.findMany({ where: { paidAt: { not: null }, ...has }, orderBy: { paidAt: "asc" }, take: LIMIT, include: { property: { select: { name: true, kind: true, owner: { select: { fullName: true } } } }, tier: { select: { name: true } } } });
    headers = ["paid_at", "property", "kind", "owner", "tier", "amount_naira", "starts_at", "expires_at"];
    rows = x.map((o) => [o.paidAt, o.property.name, o.property.kind, o.property.owner.fullName, o.tier.name, o.amountNaira, o.startsAt, o.expiresAt]);
  } else if (what === "rent") {
    const x = await prisma.paymentToken.findMany({ where: { status: "PAID", ...(Object.keys(createdAt).length ? { confirmedAt: createdAt } : {}) }, orderBy: { confirmedAt: "asc" }, take: LIMIT, include: { unit: { select: { title: true, property: { select: { name: true } } } }, tenant: { select: { fullName: true } } } });
    headers = ["confirmed_at", "code", "kind", "property", "unit", "tenant", "rent_naira", "caution_naira", "service_charge_naira", "total_naira"];
    rows = x.map((t) => [t.confirmedAt, t.code, t.kind, t.unit.property.name, t.unit.title, t.tenant.fullName, t.rentNaira, t.cautionNaira, t.serviceChargeNaira, totalOf(t)]);
  } else if (what === "tickets") {
    const x = await prisma.maintenanceTicket.findMany({ where: has, orderBy: { createdAt: "asc" }, take: LIMIT, include: { unit: { select: { title: true, property: { select: { name: true } } } } } });
    headers = ["created_at", "property", "unit", "category", "urgency", "status", "escalated", "reopened", "resolved_at", "cost_naira"];
    rows = x.map((t) => [t.createdAt, t.unit.property.name, t.unit.title, t.category, t.urgency, t.status, t.escalated, t.reopenedCount, t.resolvedAt, t.costNaira === null ? "" : t.costNaira]);
  } else if (what === "users") {
    const x = await prisma.user.findMany({ where: has, orderBy: { createdAt: "asc" }, take: LIMIT, select: { createdAt: true, fullName: true, role: true, status: true, emailVerified: true, phoneVerified: true, kyc: { select: { status: true } } } });
    headers = ["joined", "name", "role", "status", "email_verified", "phone_verified", "kyc_status"];
    rows = x.map((u) => [u.createdAt, u.fullName, u.role, u.status, u.emailVerified, u.phoneVerified, u.kyc?.status ?? ""]);
  } else return res.status(404).json({ error: "Choose onboarding, rent, tickets or users" });
  await audit(req, "EXPORT_CSV", "Export", what, { rows: rows.length });
  res.type("text/csv").set("Content-Disposition", `attachment; filename="${what}-${new Date().toISOString().slice(0, 10)}.csv"`).send(toCsv(headers, rows));
});

export default r;
