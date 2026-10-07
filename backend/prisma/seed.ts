import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // Super admin
  await prisma.user.upsert({
    where: { email: process.env.ADMIN_EMAIL! },
    update: {},
    create: {
      role: "ADMIN", fullName: "Platform Admin", email: process.env.ADMIN_EMAIL!, phone: "08000000000",
      passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD!, 12), emailVerified: true, phoneVerified: true,
    },
  });

  // Unit types
  for (const name of ["Single Room", "Self-Contain", "Room & Parlour", "1-Bedroom Flat", "2-Bedroom Flat", "3-Bedroom Flat", "Duplex", "Bungalow", "Shop", "Office"])
    await prisma.unitType.upsert({ where: { name }, update: {}, create: { name } });

  // Features
  const features: [string, string][] = [
    ["Borehole", "Utilities"], ["Prepaid meter", "Utilities"], ["Water supply", "Utilities"], ["Generator", "Utilities"], ["Solar", "Utilities"],
    ["Fenced & gated", "Security"], ["Security guard", "Security"], ["CCTV", "Security"],
    ["Parking space", "Comfort"], ["Tiled floor", "Comfort"], ["POP ceiling", "Comfort"], ["Wardrobe", "Comfort"], ["BQ (boys' quarters)", "Comfort"], ["Fitted kitchen", "Comfort"],
  ];
  for (const [name, category] of features)
    await prisma.feature.upsert({ where: { name }, update: {}, create: { name, category } });

  // Starter fee tiers (admin can edit; amounts in naira — placeholders)
  if ((await prisma.onboardingFeeTier.count()) === 0)
    await prisma.onboardingFeeTier.createMany({ data: [
      { name: "Single house / flat / room", kind: "HOUSE", minUnits: 1, maxUnits: null, amountNaira: 10_000 },
      { name: "Building 2-10 units", kind: "BUILDING", minUnits: 2, maxUnits: 10, amountNaira: 25_000 },
      { name: "Building 11+ units", kind: "BUILDING", minUnits: 11, maxUnits: null, amountNaira: 50_000 },
      { name: "Individual-owned estate (all its houses included)", kind: "ESTATE", minUnits: 1, maxUnits: null, amountNaira: 150_000 },
    ] });

  // Starter location (admin adds the rest from the dashboard)
  const lagos = (await prisma.location.findFirst({ where: { name: "Lagos", level: "STATE" } })) ??
    (await prisma.location.create({ data: { name: "Lagos", level: "STATE" } }));
  console.log("Seed complete. Lagos id:", lagos.id);
}
main().finally(() => prisma.$disconnect());
