import { Router, Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { pickTier } from "../lib/fees";
import { initCheckout, paystackConfigured, settlePayment } from "../lib/payments";
import { requireAuth, requireRole } from "../middleware/auth";

const r = Router();
r.use(requireAuth, requireRole("OWNER", "MANAGER"));
const DAY = 86_400_000;

// Owner, or manager with an ACTIVE assignment. Anything else looks like "not found".
async function access(req: Request) {
  const p = await prisma.property.findUnique({ where: { id: req.params.id } });
  if (!p) return null;
  if (p.ownerId === req.user!.id) return { p, isOwner: true };
  if (req.user!.role === "MANAGER" && (await prisma.managerAssignment.findFirst({ where: { propertyId: { in: [p.id, ...(p.parentId ? [p.parentId] : [])] }, managerId: req.user!.id, active: true } }))) return { p, isOwner: false };
  return null;
}
const ownFile = (req: Request, k: string) => k.startsWith(req.user!.id + "-") && /^[\w-]+\.\w+$/.test(k);

// Houses inside an individually-owned estate are covered by the ESTATE's documents, review and yearly fee.
const notChild: any = async (req: Request, res: Response, next: any) => {
  const p = await prisma.property.findUnique({ where: { id: req.params.id }, select: { parentId: true } });
  if (p?.parentId) return res.status(400).json({ error: "This house belongs to an estate and is covered by the estate's verification and fee" });
  next();
};
for (const path of ["documents", "pay", "submit", "renew"]) r.use(`/:id/${path}`, notChild);

// ───── Create (verified owners only) ─────
const createSchema = z.object({
  kind: z.enum(["HOUSE", "BUILDING", "ESTATE"]), name: z.string().min(2), address: z.string().min(5), locationId: z.string(),
  latitude: z.number().optional(), longitude: z.number().optional(), description: z.string().optional(),
  declaredUnits: z.number().int().min(1).max(2000).default(1),
  estateName: z.string().min(2).optional(), // only for a house in an estate that has MANY different owners
});
r.post("/", requireRole("OWNER"), async (req, res) => {
  const p = createSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const kyc = await prisma.kycRecord.findUnique({ where: { userId: req.user!.id } });
  if (kyc?.status !== "VERIFIED") return res.status(403).json({ error: "Complete identity verification before adding a property" });
  const loc = await prisma.location.findFirst({ where: { id: p.data.locationId, active: true } });
  if (!loc) return res.status(400).json({ error: "Unknown location" });
  if (p.data.kind === "ESTATE" && p.data.estateName) return res.status(400).json({ error: "An individually-owned estate does not take an estate name" });
  const row = await prisma.property.create({ data: { ...p.data, ownerId: req.user!.id } });
  res.status(201).json(row);
});

r.get("/mine", async (req, res) => {
  const where = req.user!.role === "OWNER" ? { ownerId: req.user!.id, parentId: null } : { managers: { some: { managerId: req.user!.id, active: true } } };
  const rows = await prisma.property.findMany({
    where, orderBy: { createdAt: "desc" },
    include: { location: { select: { name: true } }, children: { select: { id: true, name: true, kind: true, address: true, declaredUnits: true } }, onboardings: { where: { expiresAt: { not: null } }, orderBy: { expiresAt: "desc" }, take: 1, select: { expiresAt: true, graceEndsAt: true } } },
  });
  res.json(rows);
});

r.get("/:id", async (req, res) => {
  const a = await access(req); if (!a) return res.status(404).json({ error: "Not found" });
  res.json(await prisma.property.findUnique({
    where: { id: a.p.id },
    include: { location: true, children: { select: { id: true, name: true, kind: true, address: true, declaredUnits: true } }, documents: { select: { id: true, docType: true, status: true, rejectReason: true, createdAt: true } },
      onboardings: { orderBy: { createdAt: "desc" }, select: { id: true, amountNaira: true, paidAt: true, startsAt: true, expiresAt: true, graceEndsAt: true, refundStatus: true } },
      managers: { include: { manager: { select: { fullName: true, email: true } } } } },
  }));
});

// ───── Proof-of-ownership documents (file first via POST /api/verify/upload) ─────
const DOC_TYPES = ["C_OF_O", "GOVERNORS_CONSENT", "DEED_OF_ASSIGNMENT", "SURVEY_PLAN", "ALLOCATION_LETTER", "UTILITY_BILL", "BUILDING_PHOTO"] as const;
r.post("/:id/documents", requireRole("OWNER"), async (req, res) => {
  const p = z.object({ docType: z.enum(DOC_TYPES), fileKey: z.string() }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const a = await access(req); if (!a?.isOwner) return res.status(404).json({ error: "Not found" });
  if (!ownFile(req, p.data.fileKey)) return res.status(400).json({ error: "Invalid file reference" });
  if (!["DRAFT", "DOCS_UPLOADED", "NEEDS_CHANGES"].includes(a.p.status)) return res.status(400).json({ error: "Documents cannot be changed in this state" });
  const doc = await prisma.propertyDocument.create({ data: { propertyId: a.p.id, docType: p.data.docType, fileUrl: p.data.fileKey } });
  if (a.p.status === "DRAFT") await prisma.property.update({ where: { id: a.p.id }, data: { status: "DOCS_UPLOADED" } });
  res.status(201).json({ id: doc.id });
});

// ───── Pay the yearly onboarding fee ─────
async function startPayment(req: Request, res: Response, p: any, purpose: "ONBOARDING_FEE" | "RENEWAL", renewedFromId?: string) {
  const tier = await pickTier(p.kind, p.declaredUnits);
  if (!tier) return res.status(400).json({ error: "No fee tier is configured for this property. Contact support." });
  const me = await prisma.user.findUnique({ where: { id: req.user!.id } });
  const reference = "PROP-" + crypto.randomBytes(8).toString("hex");
  const tx = await prisma.transaction.create({ data: { userId: me!.id, purpose, reference, amountNaira: tier.amountNaira, propertyId: p.id } });
  await prisma.propertyOnboarding.create({ data: { propertyId: p.id, tierId: tier.id, transactionId: tx.id, amountNaira: tier.amountNaira, renewedFromId } });
  if (paystackConfigured()) return res.json({ reference, amountNaira: tier.amountNaira, authorizationUrl: await initCheckout(me!.email, tier.amountNaira, reference, { propertyId: p.id, purpose }) });
  if (process.env.NODE_ENV === "development") return res.json({ reference, amountNaira: tier.amountNaira, devMode: true, note: "No Paystack key: use POST /pay/simulate" });
  res.status(503).json({ error: "Payments unavailable" });
}
r.post("/:id/pay", requireRole("OWNER"), async (req, res) => {
  const a = await access(req); if (!a?.isOwner) return res.status(404).json({ error: "Not found" });
  if (a.p.status !== "VERIFIED") return res.status(400).json({ error: "Our team must verify your property before you can pay" });
  await startPayment(req, res, a.p, "ONBOARDING_FEE");
});
r.post("/:id/renew", requireRole("OWNER"), async (req, res) => {
  const a = await access(req); if (!a?.isOwner) return res.status(404).json({ error: "Not found" });
  const last = await prisma.propertyOnboarding.findFirst({ where: { propertyId: a.p.id, expiresAt: { not: null } }, orderBy: { expiresAt: "desc" } });
  if (!last || !["ACTIVE", "EXPIRED"].includes(a.p.status)) return res.status(400).json({ error: "This property cannot be renewed" });
  if (last.expiresAt!.getTime() - Date.now() > 60 * DAY) return res.status(400).json({ error: "Renewal opens 60 days before expiry" });
  await startPayment(req, res, a.p, "RENEWAL", last.id);
});
// DEV ONLY: pretend Paystack confirmed the payment (never available outside NODE_ENV=development)
r.post("/:id/pay/simulate", requireRole("OWNER"), async (req, res) => {
  if (process.env.NODE_ENV !== "development" || paystackConfigured()) return res.status(404).end();
  const tx = await prisma.transaction.findUnique({ where: { reference: String(req.body?.reference) } });
  if (!tx || tx.userId !== req.user!.id || tx.propertyId !== req.params.id) return res.status(404).json({ error: "Not found" });
  res.json({ result: await settlePayment(tx.reference, tx.amountNaira) });
});

// ───── Submit for admin review ─────
r.post("/:id/submit", requireRole("OWNER"), async (req, res) => {
  const a = await access(req); if (!a?.isOwner) return res.status(404).json({ error: "Not found" });
  if (!["DOCS_UPLOADED", "NEEDS_CHANGES"].includes(a.p.status)) return res.status(400).json({ error: "Upload your ownership documents first" });
  const docs = await prisma.propertyDocument.count({ where: { propertyId: a.p.id, status: { not: "REJECTED" } } });
  if (!docs) return res.status(400).json({ error: "Upload at least one valid ownership document" });
  await prisma.property.update({ where: { id: a.p.id }, data: { status: "PENDING_REVIEW" } });
  res.json({ status: "PENDING_REVIEW" });
});

// ───── Add a house/building inside YOUR individually-owned estate (no extra fee, no extra review) ─────
r.post("/:id/houses", requireRole("OWNER"), async (req, res) => {
  const p = z.object({ kind: z.enum(["HOUSE", "BUILDING"]), name: z.string().min(2), address: z.string().min(3), declaredUnits: z.number().int().min(1).max(500).default(1),
    latitude: z.number().optional(), longitude: z.number().optional(), description: z.string().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const a = await access(req); if (!a?.isOwner) return res.status(404).json({ error: "Not found" });
  if (a.p.kind !== "ESTATE" || a.p.parentId) return res.status(400).json({ error: "Houses can only be added to an individually-owned estate" });
  if (a.p.status === "REJECTED") return res.status(400).json({ error: "This estate was rejected" });
  const row = await prisma.property.create({ data: { ...p.data, ownerId: a.p.ownerId, locationId: a.p.locationId, parentId: a.p.id } });
  res.status(201).json(row); // visible to tenants only while the estate is ACTIVE
});

// What the owner will pay once verified
r.get("/:id/fee", async (req, res) => {
  const a = await access(req); if (!a) return res.status(404).json({ error: "Not found" });
  const t = await pickTier(a.p.kind, a.p.declaredUnits);
  res.json(t ? { tier: t.name, amountNaira: t.amountNaira } : { tier: null });
});

// ───── Appoint a manager (needs the owner's signed authorisation letter + admin approval) ─────
r.post("/:id/managers", requireRole("OWNER"), async (req, res) => {
  const p = z.object({ managerEmail: z.string().email(), authorisationKey: z.string(), canSetPrice: z.boolean().optional(), canListUnits: z.boolean().optional(), canViewPayouts: z.boolean().optional(), canApproveTokens: z.boolean().optional(), canReceivePayments: z.boolean().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const a = await access(req); if (!a?.isOwner) return res.status(404).json({ error: "Not found" });
  if (!ownFile(req, p.data.authorisationKey)) return res.status(400).json({ error: "Invalid file reference" });
  const m = await prisma.user.findFirst({ where: { email: p.data.managerEmail, role: "MANAGER", status: "ACTIVE" } });
  if (!m) return res.status(404).json({ error: "No active manager account with that email" });
  const { managerEmail, authorisationKey, ...perms } = p.data;
  await prisma.$transaction([
    prisma.managerAuthorisation.create({ data: { propertyId: a.p.id, managerId: m.id, documentUrl: authorisationKey } }),
    prisma.managerAssignment.upsert({ where: { propertyId_managerId: { propertyId: a.p.id, managerId: m.id } }, update: { ...perms, active: false }, create: { propertyId: a.p.id, managerId: m.id, ...perms, active: false } }),
  ]);
  res.status(201).json({ status: "PENDING_ADMIN_APPROVAL" });
});
// Owner changes what an appointed manager may do. canApproveTokens = answer rent requests; canReceivePayments = tenants may be told to pay into the manager's own account.
r.patch("/:id/managers/:managerId", requireRole("OWNER"), async (req, res) => {
  const p = z.object({ canSetPrice: z.boolean(), canListUnits: z.boolean(), canViewPayouts: z.boolean(), canApproveTokens: z.boolean(), canReceivePayments: z.boolean() }).partial().safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const a = await access(req); if (!a?.isOwner) return res.status(404).json({ error: "Not found" });
  const n = await prisma.managerAssignment.updateMany({ where: { propertyId: a.p.id, managerId: req.params.managerId }, data: p.data });
  res.json({ updated: n.count > 0 });
});
r.delete("/:id/managers/:managerId", requireRole("OWNER"), async (req, res) => {
  const a = await access(req); if (!a?.isOwner) return res.status(404).json({ error: "Not found" });
  await prisma.managerAssignment.updateMany({ where: { propertyId: a.p.id, managerId: req.params.managerId }, data: { active: false } });
  res.json({ removed: true });
});

// ───── Edit and delete a property (Phase 9) ─────
const EDITABLE = ["DRAFT", "DOCS_UPLOADED", "NEEDS_CHANGES"];
r.patch("/:id", requireRole("OWNER"), async (req, res) => {
  const p = z.object({ name: z.string().min(2), address: z.string().min(5), description: z.string().max(3000).nullable(), declaredUnits: z.number().int().min(1).max(2000), estateName: z.string().min(2).nullable(), latitude: z.number().nullable(), longitude: z.number().nullable() }).partial().safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const a = await access(req); if (!a?.isOwner) return res.status(404).json({ error: "Not found" });
  const d = p.data, changedCore = (d.name !== undefined && d.name !== a.p.name) || (d.address !== undefined && d.address !== a.p.address);
  if (changedCore && !EDITABLE.includes(a.p.status)) return res.status(409).json({ error: "The name and address are locked after review because changing them needs re-verification. Contact support." });
  if (d.declaredUnits !== undefined && d.declaredUnits < (await prisma.unit.count({ where: { propertyId: a.p.id } }))) return res.status(409).json({ error: "You already have more units than that. Delete some units first." });
  await prisma.property.update({ where: { id: a.p.id }, data: d });
  res.json({ updated: true });
});
r.delete("/:id", requireRole("OWNER"), async (req, res) => {
  const a = await access(req); if (!a?.isOwner) return res.status(404).json({ error: "Not found" });
  if (![...EDITABLE, "REJECTED"].includes(a.p.status)) return res.status(409).json({ error: "A verified or paid property can't be deleted. Contact support." });
  const id = a.p.id;
  if ((await prisma.unit.count({ where: { propertyId: id } })) || (await prisma.property.count({ where: { parentId: id } }))) return res.status(409).json({ error: "Delete its units and houses first." });
  const w = { where: { propertyId: id } };
  try { await prisma.$transaction([prisma.propertyDocument.deleteMany(w), prisma.managerAssignment.deleteMany(w), prisma.managerAuthorisation.deleteMany(w), prisma.announcement.deleteMany(w), prisma.propertyOnboarding.deleteMany(w), prisma.property.delete({ where: { id } })]); }
  catch { return res.status(409).json({ error: "This property has linked records and can't be deleted." }); }
  res.json({ deleted: true });
});
export default r;
