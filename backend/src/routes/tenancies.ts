import { Router } from "express";
import fs from "fs";
import { z } from "zod";
import { readPrivate } from "../lib/storage";
import { prisma } from "../lib/prisma";
import { notify, staffOf, unitScope } from "../lib/access";
import { isPropertyListable } from "../lib/listing";
import { agreementBuffer, writeAgreement } from "../lib/pdf";
import { Fail, tokenRights } from "../lib/payToken";
import { requireAuth, requireRole } from "../middleware/auth";

const r = Router();
r.use(requireAuth);

r.get("/mine", async (req, res) => {
  const tenant = req.user!.role === "TENANT";
  if (!tenant && req.user!.role === "ADMIN") return res.status(403).json({ error: "Forbidden" });
  const rows = await prisma.tenancy.findMany({
    where: tenant ? { tenantId: req.user!.id } : { unit: unitScope(req.user!.id, req.user!.role) },
    orderBy: { endsAt: "asc" }, take: 200,
    include: { unit: { select: { id: true, title: true, property: { select: { name: true } } } }, tenant: { select: { fullName: true, phone: true } } } });
  res.json(rows.map((t) => ({ id: t.id, unit: t.unit, tenant: tenant ? undefined : t.tenant, startsAt: t.startsAt, endsAt: t.endsAt, daysLeft: Math.ceil((t.endsAt.getTime() - Date.now()) / 86_400_000),
    active: t.active, endedAt: t.endedAt, rentKobo: t.rentKobo, renewedCount: t.renewedCount, moveInConfirmedAt: t.moveInConfirmedAt, issued: !!t.agreementUrl, agreementUrl: `/api/tenancies/${t.id}/agreement` })));
});

r.post("/:id/confirm-move-in", requireRole("TENANT"), async (req, res) => {
  const t = await prisma.tenancy.findFirst({ where: { id: req.params.id, tenantId: req.user!.id, active: true }, include: { unit: { select: { title: true, propertyId: true } } } });
  if (!t) return res.status(404).json({ error: "Not found" });
  if (t.moveInConfirmedAt) return res.json({ confirmed: true });
  await prisma.tenancy.update({ where: { id: t.id }, data: { moveInConfirmedAt: new Date() } });
  await notify(await staffOf(t.unit.propertyId), "TENANCY", "Tenant moved in", `The tenant confirmed moving in to "${t.unit.title}".`);
  res.json({ confirmed: true });
});

// Tenant, property staff, or admin can open the agreement. Generated at payment confirmation; rebuilt here if the file is missing.
r.get("/:id/agreement", async (req, res) => {
  const t = await prisma.tenancy.findUnique({ where: { id: req.params.id }, include: { unit: { select: { propertyId: true } } } });
  if (!t) return res.status(404).json({ error: "Not found" });
  const role = req.user!.role;
  const ok = role === "ADMIN" || (role === "TENANT" ? t.tenantId === req.user!.id : !!(await tokenRights(req.user!.id, t.unit.propertyId)));
  if (!ok) return res.status(404).json({ error: "Not found" });
  let buf: Buffer | null = null;
  if (t.agreementUrl && /^agreement-[\w-]+\.pdf$/.test(t.agreementUrl)) buf = await readPrivate(t.agreementUrl);
  if (!buf) return res.status(404).json({ error: "Your landlord has not issued the agreement yet" });
  res.type("application/pdf").set("Content-Disposition", 'inline; filename="tenancy-agreement.pdf"').send(buf);
});

// End a tenancy (move-out). The unit goes back to DRAFT so the owner can review price/photos; relist:true puts it straight on the market.
r.post("/:id/end", requireRole("OWNER", "MANAGER"), async (req, res) => {
  const p = z.object({ relist: z.boolean().optional() }).safeParse(req.body ?? {});
  if (!p.success) return res.status(400).json(p.error.flatten());
  const t = await prisma.tenancy.findUnique({ where: { id: req.params.id }, include: { unit: { include: { images: true } } } });
  const rights = t && (await tokenRights(req.user!.id, t.unit.propertyId));
  if (!t || !rights) return res.status(404).json({ error: "Not found" });
  if (!rights.canApprove) throw new Fail(403, "Not allowed");
  if (!t.active) throw new Fail(409, "This tenancy has already ended");
  if (await prisma.paymentToken.findFirst({ where: { tenancyId: t.id, status: { in: ["ACTIVE", "PAYMENT_CLAIMED", "DISPUTED"] } } })) throw new Fail(409, "A renewal payment is in progress. Resolve it first.");
  const canRelist = p.data.relist && t.unit.rentKobo > 0 && t.unit.images.length >= 3 && (await isPropertyListable(t.unit.propertyId));
  await prisma.$transaction([
    prisma.tenancy.update({ where: { id: t.id }, data: { active: false, endedAt: new Date() } }),
    prisma.unit.updateMany({ where: { id: t.unitId, status: "OCCUPIED" }, data: { status: canRelist ? "AVAILABLE" : "DRAFT" } }),
  ]);
  await notify([t.tenantId], "TENANCY", "Tenancy ended", `Your tenancy of "${t.unit.title}" has been closed.`);
  res.json({ ended: true, unitStatus: canRelist ? "AVAILABLE" : "DRAFT", relistSkipped: p.data.relist && !canRelist ? "Needs rent, 3+ photos and an active yearly fee" : undefined });
});

export default r;
