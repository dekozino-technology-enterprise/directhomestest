import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { notify } from "../lib/access";
import { tokenRights } from "../lib/payToken";
import { readPrivate, sendPrivate } from "../lib/storage";
import { issueAgreement, previewAgreement } from "../lib/pdf";
import { requireAuth, requireRole } from "../middleware/auth";

// Landlords write their own agreements, add a logo, and issue them to the tenants they choose after payment is confirmed.
const r = Router();
r.use(requireAuth, requireRole("OWNER", "MANAGER"));
const ownerOnly = requireRole("OWNER");
const schema = z.object({ name: z.string().min(2).max(80), body: z.string().min(30).max(30000), logoKey: z.string().regex(/^[\w-]+\.(png|jpg)$/).nullable().optional(), isDefault: z.boolean().optional() });
const myLogo = async (uid: string, k?: string | null) => !k || (k.startsWith(uid + "-") && !!(await readPrivate(k)));

async function ownerIds(req: any): Promise<string[]> {
  if (req.user.role === "OWNER") return [req.user.id];
  const as = await prisma.managerAssignment.findMany({ where: { managerId: req.user.id, active: true }, select: { propertyId: true } });
  const ps = await prisma.property.findMany({ where: { id: { in: as.map((a) => a.propertyId) } }, select: { ownerId: true } });
  return [...new Set(ps.map((p) => p.ownerId))];
}
const visible = async (req: any) => prisma.agreementTemplate.findFirst({ where: { id: req.params.id, active: true, ownerId: { in: await ownerIds(req) } } });

r.get("/templates", async (req, res) => {
  const rows = await prisma.agreementTemplate.findMany({ where: { active: true, ownerId: { in: await ownerIds(req) } }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] });
  res.json(rows.map((t) => ({ id: t.id, name: t.name, body: t.body, hasLogo: !!t.logoKey, isDefault: t.isDefault, updatedAt: t.updatedAt })));
});
r.post("/templates", ownerOnly, async (req, res) => {
  const p = schema.safeParse(req.body); if (!p.success) return res.status(400).json(p.error.flatten());
  const uid = req.user!.id;
  if (!(await myLogo(uid, p.data.logoKey))) return res.status(400).json({ error: "Upload the logo again (PNG or JPG)" });
  if ((await prisma.agreementTemplate.count({ where: { ownerId: uid, active: true } })) >= 20) return res.status(409).json({ error: "You can keep up to 20 templates" });
  const first = (await prisma.agreementTemplate.count({ where: { ownerId: uid, active: true } })) === 0, isDefault = p.data.isDefault || first;
  const [, t] = await prisma.$transaction([
    prisma.agreementTemplate.updateMany({ where: { ownerId: uid }, data: isDefault ? { isDefault: false } : {} }),
    prisma.agreementTemplate.create({ data: { ownerId: uid, name: p.data.name, body: p.data.body, logoKey: p.data.logoKey ?? null, isDefault } }),
  ]);
  res.status(201).json({ id: t.id });
});
r.patch("/templates/:id", ownerOnly, async (req, res) => {
  const p = schema.partial().safeParse(req.body); if (!p.success) return res.status(400).json(p.error.flatten());
  const uid = req.user!.id, t = await prisma.agreementTemplate.findFirst({ where: { id: req.params.id, ownerId: uid, active: true } });
  if (!t) return res.status(404).json({ error: "Not found" });
  if (!(await myLogo(uid, p.data.logoKey))) return res.status(400).json({ error: "Upload the logo again (PNG or JPG)" });
  await prisma.$transaction([
    ...(p.data.isDefault ? [prisma.agreementTemplate.updateMany({ where: { ownerId: uid }, data: { isDefault: false } })] : []),
    prisma.agreementTemplate.update({ where: { id: t.id }, data: { name: p.data.name, body: p.data.body, logoKey: p.data.logoKey, isDefault: p.data.isDefault } }),
  ]);
  res.json({ updated: true });
});
r.delete("/templates/:id", ownerOnly, async (req, res) => {
  const t = await prisma.agreementTemplate.findFirst({ where: { id: req.params.id, ownerId: req.user!.id, active: true } });
  if (!t) return res.status(404).json({ error: "Not found" });
  await prisma.agreementTemplate.update({ where: { id: t.id }, data: { active: false, isDefault: false } }); // agreements already issued are PDFs and stay valid
  res.json({ deleted: true });
});
r.get("/templates/:id/logo", async (req, res) => {
  const t = await visible(req); if (!t?.logoKey) return res.status(404).json({ error: "Not found" });
  await sendPrivate(res, t.logoKey);
});
r.get("/templates/:id/preview", async (req, res) => {
  const t = await visible(req); if (!t) return res.status(404).json({ error: "Not found" });
  const owner = await prisma.user.findUnique({ where: { id: t.ownerId }, select: { fullName: true } });
  const buf = await previewAgreement(t, t.ownerId, owner?.fullName ?? "Landlord");
  res.type("application/pdf").set("Content-Disposition", 'inline; filename="agreement-preview.pdf"').send(buf);
});

// Issue the chosen template to the chosen tenants (their details are filled in automatically). Issuing again replaces the earlier PDF.
r.post("/issue", async (req, res) => {
  const p = z.object({ templateId: z.string(), tenancyIds: z.array(z.string()).min(1).max(50) }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const tpl = await prisma.agreementTemplate.findFirst({ where: { id: p.data.templateId, active: true, ownerId: { in: await ownerIds(req) } } });
  if (!tpl) return res.status(404).json({ error: "Template not found" });
  let issued = 0; const skipped: string[] = [];
  for (const id of p.data.tenancyIds) {
    const t = await prisma.tenancy.findUnique({ where: { id }, include: { unit: { select: { title: true, propertyId: true, property: { select: { ownerId: true } } } } } });
    const rights = t && (await tokenRights(req.user!.id, t.unit.propertyId));
    if (!t || !rights || !(rights.isOwner || rights.canApprove) || t.unit.property.ownerId !== tpl.ownerId) { skipped.push(id); continue; }
    if (!(await issueAgreement(id, tpl))) { skipped.push(id); continue; }
    await notify([t.tenantId], "AGREEMENT", "Your tenancy agreement is ready", `The agreement for "${t.unit.title}" has been issued. Open your dashboard to view or download it.`);
    issued++;
  }
  res.json({ issued, skipped });
});

export default r;
