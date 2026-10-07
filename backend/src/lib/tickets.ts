import { Request } from "express";
import { TicketStatus, Urgency } from "@prisma/client";
import { prisma } from "./prisma";
import { staffOf } from "./access";

export const CATEGORIES = ["PLUMBING", "ROOFING_LEAKAGE", "ELECTRICAL", "WATER_PUMP", "SANITATION", "SECURITY", "APPLIANCE", "OTHER"] as const;
export const ACTIVE: TicketStatus[] = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "REOPENED"];

// What the owner/manager may move a ticket to. CLOSED is the tenant's decision (or the auto-close job after 7 days).
export const STAFF_NEXT: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ["ACKNOWLEDGED", "IN_PROGRESS"], ACKNOWLEDGED: ["IN_PROGRESS", "RESOLVED"], IN_PROGRESS: ["RESOLVED"],
  REOPENED: ["ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED"], RESOLVED: [], CLOSED: [],
};
export const statusesThatCanGoTo = (to: TicketStatus) => (Object.keys(STAFF_NEXT) as TicketStatus[]).filter((s) => STAFF_NEXT[s].includes(to));

// Days before an unresolved ticket is escalated to admin. TICKET_SLA_DAYS is the normal (MEDIUM) value; urgent tickets get less time.
export const slaDays = (u: Urgency) => {
  const base = Number(process.env.TICKET_SLA_DAYS) || 7;
  return u === "EMERGENCY" ? 1 : u === "HIGH" ? Math.min(3, base) : u === "LOW" ? base * 2 : base;
};
export const REOPEN_WINDOW_DAYS = 7, AUTO_CLOSE_DAYS = 7;

const include = {
  unit: { select: { id: true, title: true, propertyId: true } },
  vendor: true,
  comments: { orderBy: { createdAt: "asc" as const } },
  attachments: { orderBy: { createdAt: "asc" as const } },
  tenant: { select: { id: true, fullName: true, phone: true } },
};

// Finds the ticket and says who is looking: the tenant who raised it, staff of its property, or an admin. Anyone else gets null (404).
export async function loadTicket(req: Request, id: string) {
  const t = await prisma.maintenanceTicket.findUnique({ where: { id }, include });
  if (!t) return null;
  const { id: me, role } = req.user!;
  if (role === "ADMIN") return { t, kind: "admin" as const };
  if (role === "TENANT") return t.tenantId === me ? { t, kind: "tenant" as const } : null;
  return (await staffOf(t.unit.propertyId)).includes(me) ? { t, kind: "staff" as const } : null;
}
export type LoadedTicket = NonNullable<Awaited<ReturnType<typeof loadTicket>>>;

export async function ticketView({ t, kind }: LoadedTicket) {
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(t.comments.map((c) => c.authorId))] } }, select: { id: true, fullName: true, role: true } });
  const who = new Map(people.map((p) => [p.id, p]));
  const seeAll = kind !== "tenant";
  return {
    id: t.id, unit: { id: t.unit.id, title: t.unit.title }, category: t.category, title: t.title, description: t.description, urgency: t.urgency, status: t.status,
    createdAt: t.createdAt, acknowledgedAt: t.acknowledgedAt, resolvedAt: t.resolvedAt, closedAt: t.closedAt, reopenedCount: t.reopenedCount,
    escalated: t.escalated, escalatedAt: t.escalatedAt,
    vendor: t.vendor ? (seeAll ? { id: t.vendor.id, name: t.vendor.name, trade: t.vendor.trade, phone: t.vendor.phone } : { name: t.vendor.name, trade: t.vendor.trade }) : null,
    ...(seeAll ? { tenant: t.tenant, estimateNaira: t.estimateNaira, costNaira: t.costNaira } : {}),
    comments: t.comments.filter((c) => seeAll || !c.internal).map((c) => ({ id: c.id, body: c.body, internal: c.internal, at: c.createdAt, by: who.get(c.authorId)?.fullName ?? "User", role: who.get(c.authorId)?.role ?? null })),
    attachments: t.attachments.map((a) => ({ id: a.id, phase: a.phase, url: `/api/tickets/${t.id}/files/${a.id}`, at: a.createdAt })),
  };
}
