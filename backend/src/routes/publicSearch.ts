import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { liveConds } from "../lib/listing";

const r = Router(); // no login needed to browse; contact details are never exposed here

r.get("/meta", async (_q, res) => res.json({
  unitTypes: await prisma.unitType.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  features: await prisma.feature.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
}));
r.get("/locations", async (req, res) => {
  const parentId = typeof req.query.parentId === "string" ? req.query.parentId : null;
  res.json(await prisma.location.findMany({ where: { parentId, active: true }, orderBy: { name: "asc" } }));
});

async function locationIds(id: string) { // a state/LGA/city search includes everything beneath it
  const ids = [id]; let frontier = [id];
  for (let i = 0; i < 3 && frontier.length; i++) {
    frontier = (await prisma.location.findMany({ where: { parentId: { in: frontier }, active: true }, select: { id: true } })).map((k) => k.id);
    ids.push(...frontier);
  }
  return ids;
}

const searchSchema = z.object({
  locationId: z.string().optional(), q: z.string().max(80).optional(), estate: z.string().max(80).optional(), unitTypeId: z.string().optional(),
  minRent: z.coerce.number().int().min(0).optional(), maxRent: z.coerce.number().int().min(0).optional(),
  bedrooms: z.coerce.number().int().min(0).optional(), bathrooms: z.coerce.number().int().min(0).optional(),
  furnished: z.enum(["true", "false"]).optional(), payDuration: z.enum(["MONTHLY", "QUARTERLY", "BIANNUAL", "ANNUAL"]).optional(),
  featureIds: z.string().optional(), sort: z.enum(["newest", "priceAsc", "priceDesc"]).default("newest"),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(30).default(12),
});

const card = (u: any) => ({
  id: u.id, title: u.title, type: u.unitType.name, rentNaira: u.rentNaira, cautionNaira: u.cautionNaira, serviceChargeNaira: u.serviceChargeNaira,
  totalNaira: u.rentNaira + u.cautionNaira + u.serviceChargeNaira, // no hidden extras
  payDuration: u.payDuration, bedrooms: u.bedrooms, bathrooms: u.bathrooms, toilets: u.toilets, furnished: u.furnished,
  image: u.images[0]?.url ?? null, property: u.property.name, estate: u.property.estateName ?? u.property.parent?.name ?? null, location: u.property.location.name, verifiedOwner: true,
});
const include = { unitType: { select: { name: true } }, images: { orderBy: { sortOrder: "asc" as const } },
  property: { select: { name: true, estateName: true, address: true, parent: { select: { name: true } }, location: { select: { name: true } }, kind: true } } };

r.get("/units", async (req, res) => {
  const p = searchSchema.safeParse(req.query);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const q = p.data, conds: Prisma.UnitWhereInput[] = [...liveConds()]; // only live, verified, paid-up listings
  if (q.locationId) conds.push({ property: { locationId: { in: await locationIds(q.locationId) } } });
  if (q.unitTypeId) conds.push({ unitTypeId: q.unitTypeId });
  conds.push({ rentNaira: { gt: 0, ...(q.minRent !== undefined ? { gte: q.minRent } : {}), ...(q.maxRent !== undefined ? { lte: q.maxRent } : {}) } });
  if (q.bedrooms !== undefined) conds.push({ bedrooms: { gte: q.bedrooms } });
  if (q.bathrooms !== undefined) conds.push({ bathrooms: { gte: q.bathrooms } });
  if (q.furnished) conds.push({ furnished: q.furnished === "true" });
  if (q.payDuration) conds.push({ payDuration: q.payDuration });
  for (const id of (q.featureIds ?? "").split(",").filter(Boolean).slice(0, 10)) conds.push({ features: { some: { id } } });
  if (q.q) conds.push({ OR: [{ title: { contains: q.q, mode: "insensitive" } }, { property: { name: { contains: q.q, mode: "insensitive" } } }, { property: { address: { contains: q.q, mode: "insensitive" } } }] });
  if (q.estate) conds.push({ property: { OR: [{ estateName: { contains: q.estate, mode: "insensitive" } }, { parent: { name: { contains: q.estate, mode: "insensitive" } } }] } });

  const where: Prisma.UnitWhereInput = { status: "AVAILABLE", AND: conds };
  const orderBy = q.sort === "priceAsc" ? { rentNaira: "asc" as const } : q.sort === "priceDesc" ? { rentNaira: "desc" as const } : { createdAt: "desc" as const };
  const [total, rows] = await Promise.all([prisma.unit.count({ where }), prisma.unit.findMany({ where, orderBy, skip: (q.page - 1) * q.limit, take: q.limit, include })]);
  res.json({ total, page: q.page, pages: Math.ceil(total / q.limit), results: rows.map(card) });
});

r.get("/units/:id", async (req, res) => {
  const u = await prisma.unit.findFirst({ where: { id: req.params.id, status: "AVAILABLE", AND: liveConds() }, include: { ...include, features: { select: { id: true, name: true, category: true } } } });
  if (!u) return res.status(404).json({ error: "This listing is no longer available" });
  res.json({ ...card(u), description: u.description, availableFrom: u.availableFrom, address: u.property.address, images: u.images.map((i) => i.url), features: u.features });
});

export default r;
