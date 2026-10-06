import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { encrypt, isEncryptionKeyConfigured } from "../lib/crypto";
import { hashValue } from "../lib/hash";
import { accountNameMatches } from "../lib/nameMatch";
import { audit } from "../lib/audit";
import { requireAuth, requireRole } from "../middleware/auth";

// The bank accounts tenants pay rent into. Money goes straight from tenant to this account; the platform never touches it.
const r = Router();
r.use(requireAuth, requireRole("OWNER", "MANAGER"));

const pub = (a: any) => ({ id: a.id, bankName: a.bankName, accountName: a.accountName, last4: a.last4, status: a.status, isDefault: a.isDefault, rejectReason: a.rejectReason });

r.get("/", async (req, res) => {
  res.json((await prisma.receivingAccount.findMany({ where: { userId: req.user!.id, active: true }, orderBy: { createdAt: "asc" } })).map(pub));
});

r.post("/", rateLimit({ windowMs: 3600_000, max: 10 }), async (req, res) => {
  const p = z.object({
    bankName: z.string().min(2).max(60), accountName: z.string().min(3).max(100),
    accountNumber: z.string().regex(/^\d{10}$/, "Nigerian account numbers have 10 digits"), isDefault: z.boolean().optional(),
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const d = p.data, me = await prisma.user.findUnique({ where: { id: req.user!.id }, include: { kyc: { select: { status: true } } } });
  if (me!.kyc?.status !== "VERIFIED") return res.status(403).json({ error: "Complete identity verification before adding an account" });
  if (!isEncryptionKeyConfigured()) return res.status(503).json({ error: "Receiving-account encryption is not configured. Ask the site administrator to set DATA_ENC_KEY to exactly 64 hexadecimal characters in the API service environment." });
  if ((await prisma.receivingAccount.count({ where: { userId: me!.id, active: true } })) >= 5) return res.status(400).json({ error: "You can keep up to 5 accounts" });

  const numberHash = hashValue(d.bankName.toLowerCase().replace(/\s+/g, "") + d.accountNumber);
  const sameAcrossUsers = await prisma.receivingAccount.count({ where: { numberHash, userId: { not: me!.id }, active: true } });
  const nameOk = accountNameMatches(d.accountName, me!.fullName);
  // Auto-approved only when the account name matches the verified person AND nobody else already uses this account.
  const status = nameOk && !sameAcrossUsers ? "APPROVED" : "PENDING_REVIEW";
  const makeDefault = d.isDefault || (await prisma.receivingAccount.count({ where: { userId: me!.id, active: true, status: "APPROVED" } })) === 0;

  const a = await prisma.$transaction(async (tx) => {
    if (makeDefault && status === "APPROVED") await tx.receivingAccount.updateMany({ where: { userId: me!.id }, data: { isDefault: false } });
    return tx.receivingAccount.create({ data: { userId: me!.id, bankName: d.bankName.trim(), accountName: d.accountName.trim(), accountNumberEnc: encrypt(d.accountNumber), numberHash, last4: d.accountNumber.slice(-4), status, isDefault: makeDefault && status === "APPROVED" } });
  });
  if (status === "PENDING_REVIEW") await audit(req, sameAcrossUsers ? "ACCOUNT_SHARED_WITH_OTHER_USER" : "ACCOUNT_NAME_MISMATCH", "ReceivingAccount", a.id);
  res.status(201).json({ ...pub(a), note: status === "PENDING_REVIEW" ? "The account name does not match your verified name, so an admin will review it before it can be used." : undefined });
});

r.post("/:id/default", async (req, res) => {
  const a = await prisma.receivingAccount.findFirst({ where: { id: req.params.id, userId: req.user!.id, active: true, status: "APPROVED" } });
  if (!a) return res.status(404).json({ error: "Not found" });
  await prisma.$transaction([prisma.receivingAccount.updateMany({ where: { userId: req.user!.id }, data: { isDefault: false } }), prisma.receivingAccount.update({ where: { id: a.id }, data: { isDefault: true } })]);
  res.json({ isDefault: true });
});

// Removing an account never changes tokens already approved: they keep the details the tenant was shown.
r.delete("/:id", async (req, res) => {
  const n = await prisma.receivingAccount.updateMany({ where: { id: req.params.id, userId: req.user!.id }, data: { active: false, isDefault: false } });
  res.json({ removed: n.count > 0 });
});

export default r;
