import { Router } from "express";
import { prisma } from "../lib/prisma";
import { unitScope } from "../lib/access";
import { toCsv } from "../lib/csv";
import { totalOf } from "../lib/payToken";
import { ACTIVE } from "../lib/tickets";
import { requireAuth, requireRole } from "../middleware/auth";

// Owner / manager reports for their own properties.
// Rent figures: owners always see them; a manager sees them only on properties where the owner ticked "canViewPayouts".
const r = Router();
r.use(requireAuth, requireRole("OWNER", "MANAGER"));
const DAY = 86_400_000;

async function moneyPropertyIds(userId: string, role: string): Promise<string[]> {
  if (role === "OWNER") return (await prisma.property.findMany({ where: { ownerId: userId }, select: { id: true } })).map((p) => p.id);
  const a = await prisma.managerAssignment.findMany({ where: { managerId: userId, active: true, canViewPayouts: true }, select: { propertyId: true } });
  if (!a.length) return [];
  const ids = a.map((x) => x.propertyId);
  const kids = await prisma.property.findMany({ where: { parentId: { in: ids } }, select: { id: true } }); // an estate assignment covers its houses
  return [...ids, ...kids.map((k) => k.id)];
}
const rangeOf = (q: any) => {
  const to = q.to && !isNaN(+new Date(q.to)) ? new Date(q.to) : new Date();
  const from = q.from && !isNaN(+new Date(q.from)) ? new Date(q.from) : new Date(to.getTime() - 365 * DAY);
  return { from, to };
};

r.get("/summary", async (req, res) => {
  const { id, role } = req.user!, { from, to } = rangeOf(req.query);
  const scope = unitScope(id, role);
  const moneyIds = await moneyPropertyIds(id, role);
  const [units, tickets, resolved, paid, tenancies, expiring] = await Promise.all([
    prisma.unit.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    prisma.maintenanceTicket.groupBy({ by: ["status"], where: { unit: scope }, _count: { _all: true } }),
    prisma.maintenanceTicket.findMany({ where: { unit: scope, createdAt: { gte: from, lte: to } }, select: { category: true, costNaira: true, createdAt: true, resolvedAt: true, unitId: true } }),
    moneyIds.length ? prisma.paymentToken.findMany({ where: { status: "PAID", confirmedAt: { gte: from, lte: to }, unit: { propertyId: { in: moneyIds } } }, select: { confirmedAt: true, rentNaira: true, cautionNaira: true, serviceChargeNaira: true, platformFeeNaira: true, unit: { select: { property: { select: { name: true } } } } } }) : Promise.resolve([]),
    prisma.tenancy.count({ where: { active: true, unit: scope } }),
    prisma.tenancy.count({ where: { active: true, endsAt: { lt: new Date(Date.now() + 60 * DAY) }, unit: scope } }),
  ]);
  const u: Record<string, number> = Object.fromEntries(units.map((x) => [x.status, x._count._all]));
  const live = (u.AVAILABLE ?? 0) + (u.RESERVED ?? 0) + (u.OCCUPIED ?? 0);
  const tk: Record<string, number> = Object.fromEntries(tickets.map((x) => [x.status, x._count._all]));
  const done = resolved.filter((t) => t.resolvedAt);
  const cats: Record<string, number> = {}, perUnit: Record<string, Record<string, number>> = {};
  for (const t of resolved) { cats[t.category] = (cats[t.category] ?? 0) + 1; ((perUnit[t.unitId] ??= {})[t.category] ??= 0); perUnit[t.unitId][t.category]++; }
  const months: Record<string, number> = {}, props: Record<string, number> = {};
  for (const t of paid) { const m = t.confirmedAt!.toISOString().slice(0, 7); months[m] = (months[m] ?? 0) + totalOf(t); props[t.unit.property.name] = (props[t.unit.property.name] ?? 0) + totalOf(t); }
  res.json({
    period: { from, to },
    units: u, occupancyRate: live ? Math.round(((u.OCCUPIED ?? 0) / live) * 1000) / 10 : null, vacant: u.AVAILABLE ?? 0, activeTenancies: tenancies, tenanciesEndingIn60Days: expiring,
    maintenance: { byStatus: tk, open: ACTIVE.reduce((s, k) => s + (tk[k] ?? 0), 0), raisedInPeriod: resolved.length, byCategory: cats,
      avgResolutionHours: done.length ? Math.round(done.reduce((s, t) => s + (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 3_600_000, 0) / done.length) : null,
      totalCostNaira: resolved.reduce((s, t) => s + (t.costNaira ?? 0), 0), recurring: Object.entries(perUnit).flatMap(([unitId, c]) => Object.entries(c).filter(([, n]) => n >= 3).map(([category, n]) => ({ unitId, category, tickets: n }))) },
    rent: moneyIds.length ? { totalNaira: paid.reduce((s, t) => s + totalOf(t), 0), payments: paid.length, byMonth: Object.entries(months).sort().map(([month, naira]) => ({ month, naira })), byProperty: Object.entries(props).map(([property, naira]) => ({ property, naira })) } : null,
  });
});

r.get("/export/:what.csv", async (req, res) => {
  const { id, role } = req.user!, { from, to } = rangeOf(req.query);
  let headers: string[], rows: unknown[][];
  if (req.params.what === "rent") {
    const ids = await moneyPropertyIds(id, role);
    if (!ids.length) return res.status(403).json({ error: "You don't have access to payment records" });
    const x = await prisma.paymentToken.findMany({ where: { status: "PAID", confirmedAt: { gte: from, lte: to }, unit: { propertyId: { in: ids } } }, orderBy: { confirmedAt: "asc" }, take: 20_000, include: { unit: { select: { title: true, property: { select: { name: true } } } }, tenant: { select: { fullName: true } } } });
    headers = ["confirmed_at", "code", "kind", "property", "unit", "tenant", "rent_naira", "caution_naira", "service_charge_naira", "total_naira"];
    rows = x.map((t) => [t.confirmedAt, t.code, t.kind, t.unit.property.name, t.unit.title, t.tenant.fullName, t.rentNaira, t.cautionNaira, t.serviceChargeNaira, totalOf(t)]);
  } else if (req.params.what === "tickets") {
    const x = await prisma.maintenanceTicket.findMany({ where: { unit: unitScope(id, role), createdAt: { gte: from, lte: to } }, orderBy: { createdAt: "asc" }, take: 20_000, include: { unit: { select: { title: true, property: { select: { name: true } } } }, vendor: { select: { name: true } } } });
    headers = ["created_at", "property", "unit", "category", "urgency", "status", "vendor", "estimate_naira", "cost_naira", "resolved_at"];
    rows = x.map((t) => [t.createdAt, t.unit.property.name, t.unit.title, t.category, t.urgency, t.status, t.vendor?.name ?? "", t.estimateNaira === null ? "" : t.estimateNaira, t.costNaira === null ? "" : t.costNaira, t.resolvedAt]);
  } else return res.status(404).json({ error: "Choose rent or tickets" });
  res.type("text/csv").set("Content-Disposition", `attachment; filename="${req.params.what}-${to.toISOString().slice(0, 10)}.csv"`).send(toCsv(headers, rows));
});

export default r;
