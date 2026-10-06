import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import { z } from "zod";
import { persist } from "../lib/storage";
import { prisma } from "../lib/prisma";
import { hashValue } from "../lib/hash";
import { issueOtp, checkOtp } from "../lib/otp";
import { audit } from "../lib/audit";
import { requireAuth, requireRole } from "../middleware/auth";

const r = Router();
r.use(requireAuth);

// ───── OTP (email + phone) ─────
r.post("/otp/send", async (req, res) => {
  const channel = req.body?.channel === "EMAIL" ? "EMAIL" : "PHONE";
  const u = await prisma.user.findUnique({ where: { id: req.user!.id } });
  try { await issueOtp(u!.id, channel, channel === "EMAIL" ? u!.email : u!.phone); res.json({ sent: true }); }
  catch (e: any) { res.status(429).json({ error: e.message }); }
});
r.post("/otp/confirm", async (req, res) => {
  const channel = req.body?.channel === "EMAIL" ? "EMAIL" : "PHONE";
  if (!(await checkOtp(req.user!.id, channel, String(req.body?.code ?? "")))) return res.status(400).json({ error: "Invalid or expired code" });
  await prisma.user.update({ where: { id: req.user!.id }, data: channel === "EMAIL" ? { emailVerified: true } : { phoneVerified: true } });
  res.json({ verified: channel });
});

// ───── Private file upload (ID, selfie). Never publicly served. ─────
const store = multer({
  storage: multer.diskStorage({
    destination: "private-uploads",
    filename: (req, file, cb) => cb(null, `${req.user!.id}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}${({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf" } as Record<string, string>)[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_q, f, cb) => cb(null, ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(f.mimetype)),
});
r.post("/upload", requireRole("OWNER", "MANAGER"), store.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Upload a JPG, PNG, WEBP or PDF up to 5MB" });
  await persist(req.file, "private");
  res.status(201).json({ key: req.file.filename });
});

// ───── KYC submission ─────
const kycSchema = z.object({
  idType: z.enum(["NIN", "PASSPORT", "DRIVERS_LICENCE", "VOTERS_CARD"]),
  idNumber: z.string().min(6).max(30),
  idDocumentKey: z.string(),
  selfieKey: z.string(),
  bankAccountName: z.string().optional(),
});

r.post("/kyc", requireRole("OWNER", "MANAGER"), async (req, res) => {
  const p = kycSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const d = p.data, me = await prisma.user.findUnique({ where: { id: req.user!.id } });
  // Phone verification is currently disabled; email verification remains optional until a sending domain is set up.
  if (process.env.REQUIRE_EMAIL_VERIFY === "true" && !me!.emailVerified) return res.status(400).json({ error: "Verify your email first" });
  // files must be the user's own uploads
  if (![d.idDocumentKey, d.selfieKey].every((k) => k.startsWith(me!.id + "-") && /^[\w-]+\.\w+$/.test(k)))
    return res.status(400).json({ error: "Invalid file reference" });

  const idHash = hashValue(d.idType + d.idNumber);
  const banned = await prisma.blacklist.findFirst({ where: { OR: [{ type: "ID_HASH", valueHash: idHash }, { type: "PHONE", valueHash: hashValue(me!.phone) }, { type: "EMAIL", valueHash: hashValue(me!.email) }] } });
  if (banned) { await audit(req, "KYC_BLACKLIST_HIT", "User", me!.id); return res.status(403).json({ error: "Verification not possible for this account. Contact support." }); }

  const dup = await prisma.kycRecord.findUnique({ where: { idNumberHash: idHash } });
  if (dup && dup.userId !== me!.id) { await audit(req, "KYC_DUPLICATE_ID", "KycRecord", dup.id); return res.status(409).json({ error: "This ID is already registered to another account" }); }

  const existing = await prisma.kycRecord.findUnique({ where: { userId: me!.id } });
  if (existing && ["VERIFIED", "PENDING"].includes(existing.status)) return res.status(400).json({ error: `KYC already ${existing.status.toLowerCase()}` });

  const data = { idType: d.idType, idNumberHash: idHash, idDocumentUrl: d.idDocumentKey, selfieUrl: d.selfieKey, bankAccountName: d.bankAccountName, status: "PENDING" as const, rejectReason: null };
  const row = await prisma.kycRecord.upsert({ where: { userId: me!.id }, update: data, create: { ...data, userId: me!.id } });
  res.status(201).json({ id: row.id, status: row.status });
});

r.get("/kyc/status", async (req, res) => {
  const k = await prisma.kycRecord.findUnique({ where: { userId: req.user!.id }, select: { status: true, rejectReason: true } });
  res.json(k ?? { status: "UNVERIFIED", rejectReason: null });
});

export default r;
