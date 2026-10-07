import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { audit } from "../lib/audit";
import { pickTier } from "../lib/fees";
import { requireAuth, requireRole } from "../middleware/auth";

const r = Router();
r.use(requireAuth, requireRole("ADMIN"));

r.get("/properties", async (req, res) => {
  const status = (req.query.status as any) || "PENDING_REVIEW";
  res.json(await prisma.property.findMany({ where: { status, parentId: null }, orderBy: { updatedAt: "asc" }, take: 100,
    include: { owner: { select: { fullName: true } }, location: { select: { name: true } } } }));
});

r.get("/properties/:id", async (req, res) => {
  const p = await prisma.property.findUnique({ where: { id: req.params.id }, include: {
    owner: { select: { id: true, fullName: true, email: true, phone: true, kyc: { select: { status: true } } } }, location: true, children: { select: { id: true, name: true, kind: true, declaredUnits: true } }, documents: { orderBy: { createdAt: "asc" } },
    onboardings: { orderBy: { createdAt: "desc" }, include: { tier: { select: { name: true } } } },
    authLetters: { where: { status: "PENDING" }, include: { manager: { select: { fullName: true, email: true, kyc: { select: { status: true } } } } } } } });
  if (!p) return res.status(404).json({ error: "Not found" });
  const possibleDuplicates = await prisma.property.findMany({ where: { id: { not: p.id }, locationId: p.locationId, address: { equals: p.address, mode: "insensitive" }, status: { not: "REJECTED" } }, select: { id: true, name: true, status: true } });
  const t = await pickTier(p.kind, p.declaredUnits);
  res.json({ ...p, possibleDuplicates, feeDue: t ? { name: t.name, amountNaira: t.amountNaira } : null });
});

r.post("/properties/:id/documents/:docId/decision", async (req, res) => {
  const p = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), reason: z.string().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  if (p.data.decision === "REJECTED" && (p.data.reason ?? "").trim().length < 3) return res.status(400).json({ error: "A reason is required" });
  const d = await prisma.propertyDocument.update({ where: { id: req.params.docId }, data: { status: p.data.decision, rejectReason: p.data.reason, reviewedById: req.user!.id, reviewedAt: new Date() } });
  await audit(req, "DOC_" + p.data.decision, "PropertyDocument", d.id);
  res.json({ status: d.status });
});

const decisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "NEEDS_CHANGES"]), notes: z.string().optional(),
  checklist: z.object({ ownerVerified: z.boolean(), docsGenuine: z.boolean(), addressMatches: z.boolean(), noDuplicate: z.boolean() }),
});
r.post("/properties/:id/decision", async (req, res) => {
  const p = decisionSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const { decision, notes, checklist } = p.data;
  const prop = await prisma.property.findUnique({ where: { id: req.params.id }, include: { owner: { select: { kyc: { select: { status: true } } } }, documents: true, onboardings: { where: { paidAt: { not: null }, approvedAt: null }, orderBy: { paidAt: "desc" }, take: 1 } } });
  if (!prop || prop.status !== "PENDING_REVIEW") return res.status(409).json({ error: "This property is not awaiting review" });
  if (decision !== "APPROVED" && (notes ?? "").trim().length < 3) return res.status(400).json({ error: "A reason is required" });

  const ops: any[] = [prisma.verificationReview.create({ data: { entityType: "PROPERTY", entityId: prop.id, adminId: req.user!.id, decision, checklistJson: checklist, notes } })];
  let title = "More changes needed", body = notes!;
  if (decision === "APPROVED") {
    // Verification only. The property goes live after the owner pays the yearly fee.
    if (!Object.values(checklist).every(Boolean)) return res.status(400).json({ error: "Complete every checklist item before verifying" });
    if (prop.owner.kyc?.status !== "VERIFIED") return res.status(400).json({ error: "Owner identity is not verified" });
    if (!prop.documents.some((d) => d.status === "APPROVED")) return res.status(400).json({ error: "Approve at least one ownership document first" });
    if (!(await pickTier(prop.kind, prop.declaredUnits))) return res.status(400).json({ error: "No fee tier matches this property. Add one under Onboarding fees." });
    ops.push(prisma.property.update({ where: { id: prop.id }, data: { status: "VERIFIED" } }));
    title = "Property verified"; body = "Your property is verified. Pay the yearly fee to make it visible to tenants.";
  } else if (decision === "REJECTED") {
    ops.push(prisma.property.update({ where: { id: prop.id }, data: { status: "REJECTED" } }));
    title = "Property rejected";
  } else ops.push(prisma.property.update({ where: { id: prop.id }, data: { status: "NEEDS_CHANGES" } }));
  ops.push(prisma.notification.create({ data: { userId: prop.ownerId, type: "PROPERTY", title, body } }));
  await prisma.$transaction(ops);
  await audit(req, "PROPERTY_" + decision, "Property", prop.id);
  res.json({ status: decision });
});

// Manual overrides (always audited)
r.post("/properties/:id/extend", async (req, res) => {
  const p = z.object({ days: z.number().int().min(1).max(365), reason: z.string().min(3) }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const last = await prisma.propertyOnboarding.findFirst({ where: { propertyId: req.params.id, expiresAt: { not: null } }, orderBy: { expiresAt: "desc" } });
  if (!last) return res.status(404).json({ error: "No active onboarding" });
  const ms = p.data.days * 86_400_000;
  await prisma.$transaction([
    prisma.propertyOnboarding.update({ where: { id: last.id }, data: { expiresAt: new Date(last.expiresAt!.getTime() + ms), graceEndsAt: new Date(last.graceEndsAt!.getTime() + ms) } }),
    prisma.property.update({ where: { id: last.propertyId }, data: { status: "ACTIVE" } }),
  ]);
  await audit(req, "PROPERTY_EXTEND", "Property", req.params.id, p.data);
  res.json({ extended: p.data.days });
});
r.post("/properties/:id/revoke", async (req, res) => {
  const p = z.object({ reason: z.string().min(3) }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  await prisma.property.update({ where: { id: req.params.id }, data: { status: "EXPIRED" } });
  await audit(req, "PROPERTY_REVOKE", "Property", req.params.id, p.data);
  res.json({ revoked: true });
});

// Manager authorisation letters
r.post("/authorisations/:id/decision", async (req, res) => {
  const p = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const a = await prisma.managerAuthorisation.findUnique({ where: { id: req.params.id }, include: { manager: { select: { kyc: { select: { status: true } } } } } });
  if (!a || a.status !== "PENDING") return res.status(409).json({ error: "Not pending" });
  if (p.data.decision === "APPROVED" && a.manager.kyc?.status !== "VERIFIED") return res.status(400).json({ error: "The manager's identity is not verified yet" });
  await prisma.$transaction([
    prisma.managerAuthorisation.update({ where: { id: a.id }, data: { status: p.data.decision } }),
    prisma.managerAssignment.updateMany({ where: { propertyId: a.propertyId, managerId: a.managerId }, data: { active: p.data.decision === "APPROVED" } }),
  ]);
  await audit(req, "MANAGER_AUTH_" + p.data.decision, "ManagerAuthorisation", a.id);
  res.json({ status: p.data.decision });
});

export default r;
