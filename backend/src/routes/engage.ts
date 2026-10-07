import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { liveConds } from "../lib/listing";
import { propertyRole, staffOf, notify, unitScope } from "../lib/access";
import { requireAuth, requireRole } from "../middleware/auth";

const r = Router();
r.use(requireAuth);
const isTenant = (req: any) => req.user.role === "TENANT";

// Until the owner/manager shares contact, phone numbers and emails typed in chat are masked (keeps deals on-platform)
const CONTACT = /(?:\+?234|0)[\s.-]?\d{3}[\s.-]?\d{3}[\s.-]?\d{4}|[\w.+-]+@[\w-]+\.[\w.-]+|\b\d{10,13}\b/g;
const mask = (s: string, shared: boolean) => (shared ? s : s.replace(CONTACT, "[contact hidden until shared]"));

// ───── Enquiries & chat ─────
r.post("/enquiries", requireRole("TENANT"), rateLimit({ windowMs: 3600_000, max: 20 }), async (req, res) => {
  const p = z.object({ unitId: z.string(), message: z.string().min(2).max(1000) }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const unit = await prisma.unit.findFirst({ where: { id: p.data.unitId, status: "AVAILABLE", AND: liveConds() } });
  if (!unit) return res.status(404).json({ error: "This listing is no longer available" });
  const e = await prisma.enquiry.upsert({ where: { unitId_tenantId: { unitId: unit.id, tenantId: req.user!.id } }, update: {}, create: { unitId: unit.id, tenantId: req.user!.id } });
  const body = mask(p.data.message, e.contactShared);
  await prisma.message.create({ data: { enquiryId: e.id, senderId: req.user!.id, body } });
  await notify(await staffOf(unit.propertyId), "ENQUIRY", "New enquiry", `Someone asked about "${unit.title}".`);
  res.status(201).json({ id: e.id, masked: body !== p.data.message });
});

async function loadEnquiry(req: any) {
  const e = await prisma.enquiry.findUnique({ where: { id: req.params.id }, include: { unit: { select: { id: true, title: true, propertyId: true } }, tenant: { select: { id: true, fullName: true, phone: true } } } });
  if (!e) return null;
  if (isTenant(req)) return e.tenantId === req.user.id ? { e, staff: false } : null;
  return (await propertyRole(req.user.id, e.unit.propertyId)) ? { e, staff: true } : null;
}

r.get("/enquiries/mine", async (req, res) => {
  const where = isTenant(req) ? { tenantId: req.user!.id } : { unit: unitScope(req.user!.id, req.user!.role) };
  res.json(await prisma.enquiry.findMany({ where, orderBy: { createdAt: "desc" }, take: 100,
    include: { unit: { select: { title: true, status: true } }, tenant: { select: { fullName: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } } }));
});

r.get("/enquiries/:id/messages", async (req, res) => {
  const a = await loadEnquiry(req); if (!a) return res.status(404).json({ error: "Not found" });
  const messages = await prisma.message.findMany({ where: { enquiryId: a.e.id }, orderBy: { createdAt: "asc" }, take: 300 });
  await prisma.message.updateMany({ where: { enquiryId: a.e.id, senderId: { not: req.user!.id }, readAt: null }, data: { readAt: new Date() } });
  let contact = null;
  if (a.e.contactShared) {
    const who = a.staff ? a.e.tenant : a.e.sharedById ? await prisma.user.findUnique({ where: { id: a.e.sharedById }, select: { fullName: true, phone: true } }) : null;
    contact = who && { fullName: who.fullName, phone: who.phone };
  }
  res.json({ unit: a.e.unit.title, contactShared: a.e.contactShared, contact, messages });
});

r.post("/enquiries/:id/messages", rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  const p = z.object({ body: z.string().min(1).max(1000) }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const a = await loadEnquiry(req); if (!a) return res.status(404).json({ error: "Not found" });
  const body = mask(p.data.body, a.e.contactShared);
  const m = await prisma.message.create({ data: { enquiryId: a.e.id, senderId: req.user!.id, body } });
  await notify(a.staff ? [a.e.tenantId] : await staffOf(a.e.unit.propertyId), "MESSAGE", "New message", `About "${a.e.unit.title}".`);
  res.status(201).json({ id: m.id, masked: body !== p.data.body });
});

r.post("/enquiries/:id/share-contact", requireRole("OWNER", "MANAGER"), async (req, res) => {
  const a = await loadEnquiry(req); if (!a) return res.status(404).json({ error: "Not found" });
  await prisma.enquiry.update({ where: { id: a.e.id }, data: { contactShared: true, sharedById: req.user!.id } });
  await notify([a.e.tenantId], "CONTACT", "Contact shared", `You can now see the contact for "${a.e.unit.title}".`);
  res.json({ contactShared: true });
});

// ───── Viewing scheduler (always free for the tenant) ─────
const OPEN = ["REQUESTED", "CONFIRMED", "RESCHEDULED"] as const;
r.post("/viewings", requireRole("TENANT"), async (req, res) => {
  const p = z.object({ unitId: z.string(), proposedAt: z.string().datetime(), note: z.string().max(300).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const when = new Date(p.data.proposedAt);
  if (when.getTime() < Date.now() + 3600_000 || when.getTime() > Date.now() + 60 * 86_400_000) return res.status(400).json({ error: "Choose a time between 1 hour and 60 days from now" });
  const unit = await prisma.unit.findFirst({ where: { id: p.data.unitId, status: "AVAILABLE", AND: liveConds() } });
  if (!unit) return res.status(404).json({ error: "This listing is no longer available" });
  if (!(await prisma.enquiry.findUnique({ where: { unitId_tenantId: { unitId: unit.id, tenantId: req.user!.id } } }))) return res.status(400).json({ error: "Send an enquiry first" });
  if (await prisma.viewing.findFirst({ where: { unitId: unit.id, tenantId: req.user!.id, status: { in: [...OPEN] } } })) return res.status(409).json({ error: "You already have an open viewing request for this unit" });
  const v = await prisma.viewing.create({ data: { unitId: unit.id, tenantId: req.user!.id, proposedAt: when, note: p.data.note } });
  await notify(await staffOf(unit.propertyId), "VIEWING", "Viewing requested", `For "${unit.title}" on ${when.toLocaleString()}.`);
  res.status(201).json({ id: v.id, status: v.status });
});

r.get("/viewings/mine", async (req, res) => {
  const where = isTenant(req) ? { tenantId: req.user!.id } : { unit: unitScope(req.user!.id, req.user!.role) };
  res.json(await prisma.viewing.findMany({ where, orderBy: { proposedAt: "asc" }, take: 100, include: { unit: { select: { title: true } } } }));
});

r.post("/viewings/:id/action", async (req, res) => {
  const p = z.object({ action: z.enum(["confirm", "reschedule", "accept", "complete", "cancel"]), proposedAt: z.string().datetime().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const v = await prisma.viewing.findUnique({ where: { id: req.params.id }, include: { unit: { select: { title: true, propertyId: true } } } });
  if (!v) return res.status(404).json({ error: "Not found" });
  const tenant = isTenant(req);
  if (tenant ? v.tenantId !== req.user!.id : !(await propertyRole(req.user!.id, v.unit.propertyId))) return res.status(404).json({ error: "Not found" });

  const { action } = p.data, s = v.status;
  let next: "CONFIRMED" | "RESCHEDULED" | "COMPLETED" | "CANCELLED" | null = null, at: Date | undefined;
  if (!tenant && action === "confirm" && s === "REQUESTED") next = "CONFIRMED";
  else if (!tenant && action === "reschedule" && (s === "REQUESTED" || s === "CONFIRMED") && p.data.proposedAt) { at = new Date(p.data.proposedAt); if (at.getTime() < Date.now()) return res.status(400).json({ error: "Pick a future time" }); next = "RESCHEDULED"; }
  else if (tenant && action === "accept" && s === "RESCHEDULED") next = "CONFIRMED";
  else if (!tenant && action === "complete" && s === "CONFIRMED") next = "COMPLETED";
  else if (action === "cancel" && (OPEN as readonly string[]).includes(s)) next = "CANCELLED";
  if (!next) return res.status(409).json({ error: `Cannot ${action} a viewing that is ${s.toLowerCase()}` });

  await prisma.viewing.update({ where: { id: v.id }, data: { status: next, ...(at ? { proposedAt: at } : {}) } });
  await notify(tenant ? await staffOf(v.unit.propertyId) : [v.tenantId], "VIEWING", `Viewing ${next.toLowerCase()}`, `"${v.unit.title}"`);
  res.json({ status: next });
});

// ───── Favourites ─────
r.post("/favourites/:unitId", requireRole("TENANT"), async (req, res) => {
  if (!(await prisma.unit.findFirst({ where: { id: req.params.unitId, status: "AVAILABLE", AND: liveConds() } }))) return res.status(404).json({ error: "Not found" });
  await prisma.favourite.upsert({ where: { userId_unitId: { userId: req.user!.id, unitId: req.params.unitId } }, update: {}, create: { userId: req.user!.id, unitId: req.params.unitId } });
  res.status(201).json({ saved: true });
});
r.delete("/favourites/:unitId", requireRole("TENANT"), async (req, res) => {
  await prisma.favourite.deleteMany({ where: { userId: req.user!.id, unitId: req.params.unitId } });
  res.json({ saved: false });
});
r.get("/favourites", requireRole("TENANT"), async (req, res) =>
  res.json(await prisma.favourite.findMany({ where: { userId: req.user!.id }, include: { unit: { select: { id: true, title: true, rentNaira: true, status: true } } } })));

export default r;
