import { Router, Request } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { Prisma, TicketStatus } from "@prisma/client";
import { persist, discard, sendPrivate } from "../lib/storage";
import { prisma } from "../lib/prisma";
import { notify, staffOf, unitScope } from "../lib/access";
import { adminIds } from "../lib/payToken";
import { ACTIVE, CATEGORIES, REOPEN_WINDOW_DAYS, STAFF_NEXT, loadTicket, statusesThatCanGoTo, ticketView } from "../lib/tickets";
import { requireAuth, requireRole } from "../middleware/auth";

// Maintenance tickets. Tenants raise them; the owner and assigned managers work them; admin sees everything and takes over escalations.
const r = Router();
r.use(requireAuth);
const me = (req: Request) => req.user!.id;
const DAY = 86_400_000;

// ───── Photos / video (private: only the tenant, the property's staff and admins can open them) ─────
const EXT: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "video/mp4": ".mp4" };
const upload = multer({
  storage: multer.diskStorage({ destination: "private-uploads", filename: (req, f, cb) => cb(null, `${req.user!.id}-tk-${Date.now()}-${crypto.randomBytes(6).toString("hex")}${EXT[f.mimetype]}`) }),
  limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: (_q, f, cb) => cb(null, !!EXT[f.mimetype]),
});
const drop = (req: Request) => discard(req.file);
const num = (v: unknown, d: number, max: number) => Math.min(Math.max(parseInt(String(v ?? "")) || d, 1), max);

// ───── Tenant: raise a ticket (needs an active tenancy on that unit) ─────
const createSchema = z.object({
  unitId: z.string(), category: z.enum(CATEGORIES), title: z.string().trim().min(3).max(120), description: z.string().trim().min(5).max(2000),
  urgency: z.enum(["LOW", "MEDIUM", "HIGH", "EMERGENCY"]).default("MEDIUM"),
});
r.post("/", requireRole("TENANT"), rateLimit({ windowMs: 3600_000, max: 15 }), async (req, res) => {
  const p = createSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const ten = await prisma.tenancy.findFirst({ where: { tenantId: me(req), unitId: p.data.unitId, active: true }, include: { unit: { select: { title: true, propertyId: true } } } });
  if (!ten) return res.status(403).json({ error: "You can only report issues for a unit you currently rent" });
  const open = await prisma.maintenanceTicket.count({ where: { tenantId: me(req), unitId: ten.unitId, status: { in: ACTIVE } } });
  if (open >= 10) return res.status(429).json({ error: "You already have 10 open tickets for this unit. Wait for some to be resolved." });
  const t = await prisma.maintenanceTicket.create({ data: { ...p.data, tenantId: me(req) } });
  const loud = p.data.urgency === "EMERGENCY" || p.data.urgency === "HIGH";
  await notify(await staffOf(ten.unit.propertyId), "TICKET", loud ? `${p.data.urgency} issue reported` : "New maintenance ticket", `"${t.title}" at "${ten.unit.title}".`);
  res.status(201).json({ id: t.id, status: t.status });
});

// ───── Lists ─────
r.get("/mine", requireRole("TENANT"), async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await prisma.maintenanceTicket.findMany({
    where: { tenantId: me(req), ...(status && status in STAFF_NEXT ? { status: status as TicketStatus } : {}) }, orderBy: { updatedAt: "desc" }, take: 100,
    include: { unit: { select: { title: true } } },
  });
  res.json(rows.map((t) => ({ id: t.id, unit: t.unit.title, category: t.category, title: t.title, urgency: t.urgency, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt })));
});

r.get("/staff", requireRole("OWNER", "MANAGER"), async (req, res) => {
  const q = z.object({ status: z.string().optional(), urgency: z.enum(["LOW", "MEDIUM", "HIGH", "EMERGENCY"]).optional(), propertyId: z.string().optional(), unitId: z.string().optional(), escalated: z.enum(["true"]).optional() }).safeParse(req.query);
  if (!q.success) return res.status(400).json(q.error.flatten());
  const page = num(req.query.page, 1, 1000), limit = num(req.query.limit, 20, 50);
  const statuses = q.data.status === "active" ? ACTIVE : q.data.status && q.data.status in STAFF_NEXT ? [q.data.status as TicketStatus] : undefined;
  const where: Prisma.MaintenanceTicketWhereInput = {
    unit: { AND: [unitScope(me(req), req.user!.role), ...(q.data.propertyId ? [{ propertyId: q.data.propertyId }] : []), ...(q.data.unitId ? [{ id: q.data.unitId }] : [])] },
    ...(statuses ? { status: { in: statuses } } : {}), ...(q.data.urgency ? { urgency: q.data.urgency } : {}), ...(q.data.escalated ? { escalated: true } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.maintenanceTicket.count({ where }),
    prisma.maintenanceTicket.findMany({ where, orderBy: [{ createdAt: "desc" }], skip: (page - 1) * limit, take: limit, include: { unit: { select: { title: true, property: { select: { name: true } } } }, tenant: { select: { fullName: true } }, vendor: { select: { name: true } } } }),
  ]);
  const rank = { EMERGENCY: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
  const items = rows.map((t) => ({ id: t.id, unit: t.unit.title, property: t.unit.property.name, tenant: t.tenant.fullName, category: t.category, title: t.title, urgency: t.urgency, status: t.status, escalated: t.escalated, vendor: t.vendor?.name ?? null, estimateNaira: t.estimateNaira, costNaira: t.costNaira, createdAt: t.createdAt }))
    .sort((a, b) => (ACTIVE.includes(a.status) === ACTIVE.includes(b.status) ? rank[a.urgency] - rank[b.urgency] : ACTIVE.includes(a.status) ? -1 : 1)); // open and urgent first, within this page
  res.json({ total, page, pages: Math.ceil(total / limit), items });
});

// ───── One ticket (tenant who raised it, staff of the property, or admin) ─────
r.get("/:id", async (req, res) => {
  const l = await loadTicket(req, req.params.id);
  if (!l) return res.status(404).json({ error: "Not found" });
  res.json(await ticketView(l));
});

// ───── Files ─────
r.post("/:id/files", requireRole("TENANT", "OWNER", "MANAGER"), rateLimit({ windowMs: 3600_000, max: 60 }), upload.single("file"), async (req, res) => {
  const l = await loadTicket(req, req.params.id);
  if (!l) { drop(req); return res.status(404).json({ error: "Not found" }); }
  if (!req.file) return res.status(400).json({ error: "Upload a JPG, PNG, WEBP (up to 5MB) or MP4 (up to 20MB)" });
  if (req.file.mimetype.startsWith("image/") && req.file.size > 5 * 1024 * 1024) { drop(req); return res.status(400).json({ error: "Photos can be up to 5MB" }); }
  if (l.t.status === "CLOSED") { drop(req); return res.status(409).json({ error: "This ticket is closed" }); }
  if ((await prisma.ticketAttachment.count({ where: { ticketId: l.t.id } })) >= 12) { drop(req); return res.status(409).json({ error: "A ticket can have up to 12 files" }); }
  await persist(req.file, "private");
  const phase = l.kind === "tenant" ? "BEFORE" : z.enum(["BEFORE", "AFTER", "UPDATE"]).catch("UPDATE").parse(req.body?.phase);
  const a = await prisma.ticketAttachment.create({ data: { ticketId: l.t.id, fileKey: req.file.filename, phase, uploadedById: me(req) } });
  const others = l.kind === "tenant" ? await staffOf(l.t.unit.propertyId) : [l.t.tenantId];
  await notify(others, "TICKET", phase === "AFTER" ? "Completion photo added" : "New photo on a ticket", `"${l.t.title}" at "${l.t.unit.title}".`);
  res.status(201).json({ id: a.id, phase, url: `/api/tickets/${l.t.id}/files/${a.id}` });
});
r.get("/:id/files/:attId", async (req, res) => {
  const l = await loadTicket(req, req.params.id);
  const a = l?.t.attachments.find((x) => x.id === req.params.attId);
  if (!a || !/^[\w-]+\.\w+$/.test(a.fileKey)) return res.status(404).json({ error: "Not found" });
  await sendPrivate(res, a.fileKey);
});

// ───── Comments (staff may leave internal notes that the tenant never sees; admin may join in to mediate) ─────
r.post("/:id/comments", rateLimit({ windowMs: 3600_000, max: 120 }), async (req, res) => {
  const p = z.object({ body: z.string().trim().min(1).max(1500), internal: z.boolean().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const l = await loadTicket(req, req.params.id);
  if (!l) return res.status(404).json({ error: "Not found" });
  if (l.t.status === "CLOSED") return res.status(409).json({ error: "This ticket is closed. Reopen it to add more." });
  const internal = l.kind !== "tenant" && !!p.data.internal;
  await prisma.ticketComment.create({ data: { ticketId: l.t.id, authorId: me(req), body: p.data.body, internal } });
  if (!internal) {
    const staff = await staffOf(l.t.unit.propertyId);
    const to = l.kind === "tenant" ? staff : l.kind === "admin" ? [...staff, l.t.tenantId] : [l.t.tenantId];
    await notify(to.filter((u) => u !== me(req)), "TICKET", "New comment on a ticket", `"${l.t.title}" at "${l.t.unit.title}".`);
  }
  res.status(201).json({ ok: true });
});

// ───── Staff: move the ticket along ─────
r.post("/:id/status", requireRole("OWNER", "MANAGER"), async (req, res) => {
  const p = z.object({ status: z.enum(["ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED"]), note: z.string().trim().max(1000).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const l = await loadTicket(req, req.params.id);
  if (!l || l.kind !== "staff") return res.status(404).json({ error: "Not found" });
  const now = new Date(), to = p.data.status;
  const u = await prisma.maintenanceTicket.updateMany({
    where: { id: l.t.id, status: { in: statusesThatCanGoTo(to) } },
    data: { status: to, ...(to === "ACKNOWLEDGED" || (to === "IN_PROGRESS" && !l.t.acknowledgedAt) ? { acknowledgedAt: l.t.acknowledgedAt ?? now } : {}), ...(to === "RESOLVED" ? { resolvedAt: now } : {}) },
  });
  if (!u.count) return res.status(409).json({ error: `A ticket that is ${l.t.status.toLowerCase().replace("_", " ")} can't be moved to ${to.toLowerCase().replace("_", " ")}` });
  if (p.data.note) await prisma.ticketComment.create({ data: { ticketId: l.t.id, authorId: me(req), body: p.data.note } });
  const msg = { ACKNOWLEDGED: "We have seen your issue and will deal with it.", IN_PROGRESS: "Work has started on your issue.", RESOLVED: "Your issue was marked resolved. Please confirm it is fixed, or reopen it." }[to];
  await notify([l.t.tenantId], "TICKET", to === "RESOLVED" ? "Issue resolved" : "Ticket update", `"${l.t.title}": ${msg}`);
  res.json({ status: to });
});

// Staff: vendor, cost estimate, final cost, urgency
r.patch("/:id", requireRole("OWNER", "MANAGER"), async (req, res) => {
  const p = z.object({ vendorId: z.string().nullable().optional(), estimateNaira: z.number().int().min(0).max(1e9).nullable().optional(), costNaira: z.number().int().min(0).max(1e9).nullable().optional(), urgency: z.enum(["LOW", "MEDIUM", "HIGH", "EMERGENCY"]).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const l = await loadTicket(req, req.params.id);
  if (!l || l.kind !== "staff") return res.status(404).json({ error: "Not found" });
  if (l.t.status === "CLOSED") return res.status(409).json({ error: "This ticket is closed" });
  const data: Prisma.MaintenanceTicketUncheckedUpdateInput = {};
  if (p.data.vendorId !== undefined) {
    if (p.data.vendorId) {
      const prop = await prisma.property.findUnique({ where: { id: l.t.unit.propertyId }, select: { ownerId: true } });
      const v = await prisma.vendor.findFirst({ where: { id: p.data.vendorId, active: true, ownerId: prop!.ownerId } });
      if (!v) return res.status(400).json({ error: "Unknown vendor for this property's owner" });
    }
    data.vendorId = p.data.vendorId;
  }
  if (p.data.estimateNaira !== undefined) data.estimateNaira = p.data.estimateNaira;
  if (p.data.costNaira !== undefined) data.costNaira = p.data.costNaira;
  if (p.data.urgency) data.urgency = p.data.urgency;
  if (!Object.keys(data).length) return res.status(400).json({ error: "Nothing to change" });
  await prisma.maintenanceTicket.update({ where: { id: l.t.id }, data });
  if (data.vendorId && data.vendorId !== l.t.vendorId) await notify([l.t.tenantId], "TICKET", "Technician assigned", `Someone has been assigned to "${l.t.title}".`);
  res.json({ ok: true });
});

// ───── Tenant: confirm the fix, or reopen ─────
r.post("/:id/confirm", requireRole("TENANT"), async (req, res) => {
  const t = await prisma.maintenanceTicket.findFirst({ where: { id: req.params.id, tenantId: me(req) }, include: { unit: { select: { title: true, propertyId: true } } } });
  if (!t) return res.status(404).json({ error: "Not found" });
  const u = await prisma.maintenanceTicket.updateMany({ where: { id: t.id, status: "RESOLVED" }, data: { status: "CLOSED", closedAt: new Date() } });
  if (!u.count) return res.status(409).json({ error: "Only a ticket marked resolved can be confirmed" });
  await notify(await staffOf(t.unit.propertyId), "TICKET", "Tenant confirmed the fix", `"${t.title}" at "${t.unit.title}" is closed.`);
  res.json({ status: "CLOSED" });
});
r.post("/:id/reopen", requireRole("TENANT"), async (req, res) => {
  const p = z.object({ reason: z.string().trim().min(5).max(1000) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Tell us what is still wrong (at least a few words)" });
  const t = await prisma.maintenanceTicket.findFirst({ where: { id: req.params.id, tenantId: me(req) }, include: { unit: { select: { title: true, propertyId: true } } } });
  if (!t) return res.status(404).json({ error: "Not found" });
  const now = new Date();
  const u = await prisma.maintenanceTicket.updateMany({
    where: { id: t.id, OR: [{ status: "RESOLVED" }, { status: "CLOSED", closedAt: { gte: new Date(now.getTime() - REOPEN_WINDOW_DAYS * DAY) } }] },
    data: { status: "REOPENED", resolvedAt: null, closedAt: null, escalated: false, escalatedAt: null, slaStartAt: now, reopenedCount: { increment: 1 } },
  });
  if (!u.count) return res.status(409).json({ error: `Only a resolved ticket, or one closed in the last ${REOPEN_WINDOW_DAYS} days, can be reopened. Please raise a new ticket instead.` });
  await prisma.ticketComment.create({ data: { ticketId: t.id, authorId: me(req), body: "Reopened: " + p.data.reason } });
  await notify(await staffOf(t.unit.propertyId), "TICKET", "Ticket reopened", `"${t.title}" at "${t.unit.title}" is not fixed yet.`);
  res.json({ status: "REOPENED" });
});

export default r;
