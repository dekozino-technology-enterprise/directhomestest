import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { audit } from "../lib/audit";
import { requireAuth, requireRole } from "../middleware/auth";

const r = Router();
r.use(requireAuth, requireRole("ADMIN")); // EVERYTHING below is admin-only

// ───── Generic CRUD for admin-managed reference data ─────
const nameSchema = z.object({ name: z.string().min(2), category: z.string().optional(), icon: z.string().optional() });

function crud(path: string, model: "feature" | "unitType") {
  r.get(`/${path}`, async (_q, res) => res.json(await (prisma[model] as any).findMany({ orderBy: { name: "asc" } })));
  r.post(`/${path}`, async (req, res) => {
    const p = nameSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json(p.error.flatten());
    const data = model === "unitType" ? { name: p.data.name } : p.data;
    const row = await (prisma[model] as any).create({ data });
    await audit(req, `CREATE_${model.toUpperCase()}`, model, row.id, data);
    res.status(201).json(row);
  });
  r.patch(`/${path}/:id`, async (req, res) => {
    const p = nameSchema.partial().extend({ active: z.boolean().optional() }).safeParse(req.body);
    if (!p.success) return res.status(400).json(p.error.flatten());
    const data = model === "unitType" ? { name: p.data.name, active: p.data.active } : p.data;
    const row = await (prisma[model] as any).update({ where: { id: req.params.id }, data });
    await audit(req, `UPDATE_${model.toUpperCase()}`, model, row.id, data);
    res.json(row);
  });
  // Soft-disable instead of delete, so old listings keep working
  r.delete(`/${path}/:id`, async (req, res) => {
    const row = await (prisma[model] as any).update({ where: { id: req.params.id }, data: { active: false } });
    await audit(req, `DISABLE_${model.toUpperCase()}`, model, row.id);
    res.json(row);
  });
}
crud("features", "feature");
crud("unit-types", "unitType");

// ───── Locations (STATE > LGA > CITY > AREA) ─────
const locSchema = z.object({ name: z.string().min(2), level: z.enum(["STATE", "LGA", "CITY", "AREA"]), parentId: z.string().optional() });

r.get("/locations", async (req, res) => {
  const parentId = typeof req.query.parentId === "string" ? req.query.parentId : null;
  res.json(await prisma.location.findMany({ where: { parentId }, orderBy: { name: "asc" } }));
});
r.post("/locations", async (req, res) => {
  const p = locSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const row = await prisma.location.create({ data: p.data });
  await audit(req, "CREATE_LOCATION", "Location", row.id, p.data);
  res.status(201).json(row);
});
r.patch("/locations/:id", async (req, res) => {
  const p = z.object({ name: z.string().min(2).optional(), active: z.boolean().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const row = await prisma.location.update({ where: { id: req.params.id }, data: p.data });
  await audit(req, "UPDATE_LOCATION", "Location", row.id, p.data);
  res.json(row);
});

// ───── Onboarding fee tiers (price per property type / number of units) ─────
const tierSchema = z.object({
  name: z.string(),
  kind: z.enum(["HOUSE", "BUILDING", "ESTATE"]),
  minUnits: z.number().int().min(1).default(1),
  maxUnits: z.number().int().positive().nullable().optional(),
  amountNaira: z.number().int().positive(),
});
r.get("/fee-tiers", async (_q, res) => res.json(await prisma.onboardingFeeTier.findMany({ orderBy: [{ kind: "asc" }, { minUnits: "asc" }] })));
r.post("/fee-tiers", async (req, res) => {
  const p = tierSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const row = await prisma.onboardingFeeTier.create({ data: p.data });
  await audit(req, "CREATE_FEE_TIER", "OnboardingFeeTier", row.id, p.data);
  res.status(201).json(row);
});
r.patch("/fee-tiers/:id", async (req, res) => {
  const p = tierSchema.partial().extend({ active: z.boolean().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const row = await prisma.onboardingFeeTier.update({ where: { id: req.params.id }, data: p.data });
  await audit(req, "UPDATE_FEE_TIER", "OnboardingFeeTier", row.id, p.data);
  res.json(row);
});

// ───── User management ─────
r.get("/users", async (req, res) => {
  const { role, status, q } = req.query as Record<string, string | undefined>;
  const users = await prisma.user.findMany({
    where: {
      ...(role ? { role: role as any } : {}),
      ...(status ? { status: status as any } : {}),
      ...(q ? { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
    },
    select: { id: true, role: true, fullName: true, email: true, phone: true, status: true, createdAt: true, kyc: { select: { status: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(users);
});
r.patch("/users/:id/status", async (req, res) => {
  const p = z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"]), reason: z.string().min(3) }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  if (req.params.id === req.user!.id) return res.status(400).json({ error: "You cannot change your own status" });
  const row = await prisma.user.update({ where: { id: req.params.id }, data: { status: p.data.status }, select: { id: true, status: true } });
  await audit(req, "SET_USER_STATUS", "User", row.id, p.data);
  res.json(row);
});

// ───── Audit log viewer ─────
r.get("/audit-logs", async (_q, res) =>
  res.json(await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { actor: { select: { fullName: true } } } })));

export default r;
