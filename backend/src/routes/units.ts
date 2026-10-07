import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import fs from "fs";
import { z } from "zod";
import { persist, hasPublic } from "../lib/storage";
import { prisma } from "../lib/prisma";
import { propertyRole, unitScope } from "../lib/access";
import { isPropertyListable } from "../lib/listing";
import { requireAuth, requireRole } from "../middleware/auth";

const r = Router();
r.use(requireAuth, requireRole("OWNER", "MANAGER"));

// ───── Public listing photos (served at /media). Use S3/Cloudinary in production. ─────
const EXT: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const store = multer({
  storage: multer.diskStorage({ destination: "public-uploads", filename: (req, f, cb) => cb(null, `${req.user!.id}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}${EXT[f.mimetype]}`) }),
  limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_q, f, cb) => cb(null, !!EXT[f.mimetype]),
});
r.post("/images", store.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Upload a JPG, PNG or WEBP up to 5MB" });
  await persist(req.file, "public");
  res.status(201).json({ url: "/media/" + req.file.filename });
});
const okImages = async (urls: string[]) => { for (const u of urls) if (!/^\/media\/[\w-]+\.(jpg|png|webp)$/.test(u) || !(await hasPublic(u.slice(7)))) return false; return true; };

const unitSchema = z.object({
  propertyId: z.string(), unitTypeId: z.string(), title: z.string().min(3).max(120), description: z.string().max(3000).optional(),
  rentNaira: z.number().int().min(0), cautionNaira: z.number().int().min(0).default(0), serviceChargeNaira: z.number().int().min(0).default(0),
  payDuration: z.enum(["MONTHLY", "QUARTERLY", "BIANNUAL", "ANNUAL"]).default("ANNUAL"),
  bedrooms: z.number().int().min(0).max(20).default(0), bathrooms: z.number().int().min(0).max(20).default(0), toilets: z.number().int().min(0).max(20).default(0),
  furnished: z.boolean().default(false), availableFrom: z.string().datetime().optional(),
  featureIds: z.array(z.string()).max(40).default([]), images: z.array(z.string()).max(15).default([]),
});
const PRICE = ["rentNaira", "cautionNaira", "serviceChargeNaira"];

async function validRefs(unitTypeId?: string, featureIds?: string[]) {
  if (unitTypeId && !(await prisma.unitType.findFirst({ where: { id: unitTypeId, active: true } }))) return "Unknown unit type";
  if (featureIds?.length && (await prisma.feature.count({ where: { id: { in: featureIds }, active: true } })) !== new Set(featureIds).size) return "Unknown feature";
  return null;
}

r.post("/", async (req, res) => {
  const p = unitSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const d = p.data, role = await propertyRole(req.user!.id, d.propertyId);
  if (!role) return res.status(404).json({ error: "Property not found" });
  if (!role.canListUnits) return res.status(403).json({ error: "You are not allowed to list units here" });
  if (!(await okImages(d.images))) return res.status(400).json({ error: "Invalid image reference" });
  const bad = await validRefs(d.unitTypeId, d.featureIds); if (bad) return res.status(400).json({ error: bad });

  // Units covered by the fee: the paying property (the estate, if the house sits in one)
  const root = role.property.parentId ? await prisma.property.findUnique({ where: { id: role.property.parentId } }) : role.property;
  const used = await prisma.unit.count({ where: { property: { OR: [{ id: root!.id }, { parentId: root!.id }] } } });
  if (used >= root!.declaredUnits) return res.status(400).json({ error: `Your plan covers ${root!.declaredUnits} unit(s). Contact support to increase it.` });

  const priced = role.canSetPrice; // managers without price rights create the unit; the owner sets the price
  const unit = await prisma.unit.create({ data: {
    propertyId: d.propertyId, unitTypeId: d.unitTypeId, title: d.title, description: d.description, payDuration: d.payDuration,
    rentNaira: priced ? d.rentNaira : 0, cautionNaira: priced ? d.cautionNaira : 0, serviceChargeNaira: priced ? d.serviceChargeNaira : 0,
    bedrooms: d.bedrooms, bathrooms: d.bathrooms, toilets: d.toilets, furnished: d.furnished, availableFrom: d.availableFrom ? new Date(d.availableFrom) : undefined,
    features: { connect: d.featureIds.map((id) => ({ id })) }, images: { create: d.images.map((url, sortOrder) => ({ url, sortOrder })) },
  } });
  res.status(201).json({ id: unit.id, status: unit.status, priceSet: priced });
});

async function loadManaged(req: any) {
  const u = await prisma.unit.findUnique({ where: { id: req.params.id }, include: { images: true } });
  if (!u) return null;
  const role = await propertyRole(req.user.id, u.propertyId);
  return role ? { u, role } : null;
}

r.patch("/:id", async (req, res) => {
  const p = unitSchema.omit({ propertyId: true }).partial().safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const m = await loadManaged(req); if (!m) return res.status(404).json({ error: "Not found" });
  if (!m.role.canListUnits) return res.status(403).json({ error: "Not allowed" });
  if (["RESERVED", "OCCUPIED"].includes(m.u.status)) return res.status(409).json({ error: "This unit is reserved or occupied and cannot be edited" });
  const d = p.data;
  if (PRICE.some((k) => (d as any)[k] !== undefined) && !m.role.canSetPrice) return res.status(403).json({ error: "Only the owner can change prices" });
  if (d.images && !(await okImages(d.images))) return res.status(400).json({ error: "Invalid image reference" });
  const bad = await validRefs(d.unitTypeId, d.featureIds); if (bad) return res.status(400).json({ error: bad });
  const { rentNaira, cautionNaira, serviceChargeNaira, featureIds, images, availableFrom, ...rest } = d;
  await prisma.$transaction([
    ...(images ? [prisma.unitImage.deleteMany({ where: { unitId: m.u.id } })] : []),
    prisma.unit.update({ where: { id: m.u.id }, data: { ...rest,
      ...(rentNaira !== undefined ? { rentNaira } : {}), ...(cautionNaira !== undefined ? { cautionNaira } : {}), ...(serviceChargeNaira !== undefined ? { serviceChargeNaira } : {}),
      ...(availableFrom ? { availableFrom: new Date(availableFrom) } : {}),
      ...(featureIds ? { features: { set: featureIds.map((id) => ({ id })) } } : {}),
      ...(images ? { images: { create: images.map((url, sortOrder) => ({ url, sortOrder })) } } : {}) } }),
  ]);
  res.json({ updated: true });
});

// DRAFT/MAINTENANCE -> AVAILABLE (visible to tenants)
r.post("/:id/publish", async (req, res) => {
  const m = await loadManaged(req); if (!m) return res.status(404).json({ error: "Not found" });
  if (!m.role.canListUnits) return res.status(403).json({ error: "Not allowed" });
  if (!["DRAFT", "MAINTENANCE"].includes(m.u.status)) return res.status(409).json({ error: "Unit is not in a publishable state" });
  if (m.u.rentNaira <= 0) return res.status(400).json({ error: "Set the rent first (owner or a manager with price rights)" });
  if (m.u.images.length < 3) return res.status(400).json({ error: "Add at least 3 photos" });
  if (!(await isPropertyListable(m.u.propertyId))) return res.status(400).json({ error: "The property must be verified and its yearly fee paid before units can go live" });
  await prisma.unit.update({ where: { id: m.u.id }, data: { status: "AVAILABLE" } });
  res.json({ status: "AVAILABLE" });
});
r.post("/:id/unpublish", async (req, res) => {
  const m = await loadManaged(req); if (!m) return res.status(404).json({ error: "Not found" });
  if (!m.role.canListUnits) return res.status(403).json({ error: "Not allowed" });
  if (m.u.status !== "AVAILABLE" && m.u.status !== "MAINTENANCE") return res.status(409).json({ error: "Only available units can be taken down" });
  const status = req.body?.maintenance ? "MAINTENANCE" : "DRAFT";
  await prisma.unit.update({ where: { id: m.u.id }, data: { status } });
  res.json({ status });
});

r.get("/mine", async (req, res) => {
  const { propertyId, status } = req.query as Record<string, string | undefined>;
  res.json(await prisma.unit.findMany({
    where: { ...unitScope(req.user!.id, req.user!.role), ...(propertyId ? { propertyId } : {}), ...(status ? { status: status as any } : {}) },
    orderBy: { createdAt: "desc" }, take: 200,
    include: { property: { select: { name: true, estateName: true, parentId: true } }, unitType: { select: { name: true } }, images: { take: 1, orderBy: { sortOrder: "asc" } }, _count: { select: { enquiries: true } } },
  }));
});

// ───── Edit form data and delete (Phase 9) ─────
r.get("/:id", async (req, res) => {
  const m = await loadManaged(req); if (!m) return res.status(404).json({ error: "Not found" });
  const u = await prisma.unit.findUnique({ where: { id: m.u.id }, include: { images: { orderBy: { sortOrder: "asc" } }, features: { select: { id: true } } } });
  if (!u) return res.status(404).json({ error: "Not found" });
  const { images, features, ...rest } = u;
  res.json({ ...rest, images: images.map((i) => i.url), featureIds: features.map((f) => f.id), canSetPrice: m.role.canSetPrice });
});
r.delete("/:id", async (req, res) => {
  const m = await loadManaged(req); if (!m) return res.status(404).json({ error: "Not found" });
  if (!m.role.canListUnits) return res.status(403).json({ error: "Not allowed" });
  if (["RESERVED", "OCCUPIED"].includes(m.u.status)) return res.status(409).json({ error: "This unit is reserved or occupied and cannot be deleted" });
  const id = m.u.id, w = { where: { unitId: id } };
  const used = await Promise.all([prisma.enquiry.count(w), prisma.viewing.count(w), prisma.paymentToken.count(w), prisma.tenancy.count(w), prisma.maintenanceTicket.count(w), prisma.review.count(w), prisma.report.count(w)]);
  if (used.some((n) => n > 0)) return res.status(409).json({ error: "This unit has enquiries or history, so it can't be deleted. Take it down instead." });
  await prisma.$transaction([prisma.unitImage.deleteMany(w), prisma.favourite.deleteMany(w), prisma.unit.delete({ where: { id } })]);
  res.json({ deleted: true });
});
export default r;
