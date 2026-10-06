import { Router, Request } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { persist, discard, sendPrivate } from "../lib/storage";
import { prisma } from "../lib/prisma";
import { decrypt, encrypt } from "../lib/crypto";
import { isPropertyListable, liveConds } from "../lib/listing";
import { notify, staffOf, unitScope } from "../lib/access";
import { receiptBuffer } from "../lib/pdf";
import { requireAuth, requireRole } from "../middleware/auth";
import { Fail, OPEN_STATUSES, accountUsable, adminIds, breakdown, completeToken, defaultAccount, naira, newCode, releaseUnit, tokenRights, totalOf } from "../lib/payToken";

// Payment token flow. Rent goes straight from the tenant's bank to the owner's/manager's bank.
// The platform only keeps the record: who asked, who approved, who was paid, and who confirmed receiving it.
const r = Router();
r.use(requireAuth);
const HOUR = 3600_000, DAY = 24 * HOUR;
const me = (req: Request) => req.user!.id;

// ───── Proof-of-transfer upload (private; only the tenant, the property's staff and admins can open it) ─────
const EXT: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf" };
const upload = multer({
  storage: multer.diskStorage({ destination: "private-uploads", filename: (req, f, cb) => cb(null, `${req.user!.id}-proof-${Date.now()}-${crypto.randomBytes(6).toString("hex")}${EXT[f.mimetype]}`) }),
  limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_q, f, cb) => cb(null, !!EXT[f.mimetype]),
});
const dropUpload = (req: Request) => discard(req.file);

// ───── Views ─────
// Bank details are shown to the tenant ONLY while a token is live (approved and unexpired) or a payment is awaiting confirmation.
function tenantView(t: any) {
  const live = t.status === "ACTIVE" && t.expiresAt && t.expiresAt > new Date();
  const showPay = (live || ["PAYMENT_CLAIMED", "DISPUTED"].includes(t.status)) && t.payAccountNumberEnc;
  return {
    id: t.id, kind: t.kind, status: t.status === "ACTIVE" && !live ? "EXPIRED" : t.status, unit: t.unit && { id: t.unit.id, title: t.unit.title },
    ...breakdown(t), code: t.code, expiresAt: t.expiresAt, moveInDate: t.moveInDate, claimedAt: t.claimedAt, rejectReason: t.rejectReason, disputeReason: t.disputeReason, createdAt: t.createdAt,
    pay: showPay ? { bankName: t.payBankName, accountName: t.payAccountName, accountNumber: decrypt(t.payAccountNumberEnc), narration: t.code } : null,
    warning: showPay ? "Pay the exact total to this account only, and write the code as the transfer narration. The platform never asks you to pay anyone else, and does not receive or hold your money." : undefined,
    receiptUrl: t.status === "PAID" ? `/api/tokens/${t.id}/receipt` : undefined,
  };
}
async function staffView(t: any, userId: string) {
  const rights = await tokenRights(userId, t.unit.propertyId);
  const shareTenant = ["ACTIVE", "PAYMENT_CLAIMED", "DISPUTED", "PAID"].includes(t.status);
  return {
    id: t.id, kind: t.kind, status: t.status, code: t.code, unit: { id: t.unit.id, title: t.unit.title, status: t.unit.status }, ...breakdown(t),
    tenant: { fullName: t.tenant.fullName, ...(shareTenant ? { phone: t.tenant.phone } : {}) }, moveInDate: t.moveInDate, note: t.tenantNote,
    expiresAt: t.expiresAt, claimedAt: t.claimedAt, claimReference: t.claimReference, hasProof: !!t.proofKey, disputeReason: t.disputeReason, createdAt: t.createdAt,
    payTo: t.payAccountName ? { name: t.payAccountName, bankName: t.payBankName, last4: decrypt(t.payAccountNumberEnc).slice(-4) } : null,
    can: { approve: !!rights?.canApprove && t.status === "REQUESTED", confirm: !!rights && (rights.isOwner || t.payToUserId === userId) && ["PAYMENT_CLAIMED", "DISPUTED"].includes(t.status) },
  };
}
const tokenInclude = { unit: true, tenant: { select: { id: true, fullName: true, phone: true } } } as const;

// ───── Tenant: request a token (needs an account and a live unit) ─────
r.post("/request", requireRole("TENANT"), rateLimit({ windowMs: HOUR, max: 10 }), async (req, res) => {
  const p = z.object({ unitId: z.string(), moveInDate: z.string().datetime().optional(), note: z.string().max(300).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const user = await prisma.user.findUnique({ where: { id: me(req) } });
  const unit = await prisma.unit.findFirst({ where: { id: p.data.unitId, status: "AVAILABLE", AND: liveConds() } });
  if (!unit || unit.rentKobo <= 0) return res.status(404).json({ error: "This listing is no longer available" });
  const moveIn = p.data.moveInDate ? new Date(p.data.moveInDate) : undefined;
  if (moveIn && (moveIn.getTime() < Date.now() - DAY || moveIn.getTime() > Date.now() + 120 * DAY)) return res.status(400).json({ error: "Choose a move-in date within the next 120 days" });
  if (await prisma.paymentToken.findFirst({ where: { unitId: unit.id, tenantId: me(req), status: { in: [...OPEN_STATUSES] } } })) return res.status(409).json({ error: "You already have an open request for this unit" });
  if ((await prisma.paymentToken.count({ where: { tenantId: me(req), status: { in: ["REQUESTED", "ACTIVE", "PAYMENT_CLAIMED"] } } })) >= 3) return res.status(400).json({ error: "You can have up to 3 open requests at a time. Cancel one first." });

  const t = await prisma.paymentToken.create({ data: { unitId: unit.id, tenantId: me(req), rentKobo: unit.rentKobo, cautionKobo: unit.cautionKobo, serviceChargeKobo: unit.serviceChargeKobo, moveInDate: moveIn, tenantNote: p.data.note } });
  await notify(await staffOf(unit.propertyId), "TOKEN", "Payment token requested", `${user!.fullName} wants to rent "${unit.title}". Review and approve to share your account details.`);
  res.status(201).json({ id: t.id, status: t.status, ...breakdown(t) });
});

// Tenant: renew a running tenancy (rent + service charge, no new caution deposit)
r.post("/renew", requireRole("TENANT"), rateLimit({ windowMs: HOUR, max: 5 }), async (req, res) => {
  const p = z.object({ tenancyId: z.string(), note: z.string().max(300).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const ten = await prisma.tenancy.findFirst({ where: { id: p.data.tenancyId, tenantId: me(req), active: true }, include: { unit: true } });
  if (!ten) return res.status(404).json({ error: "Tenancy not found" });
  if (ten.endsAt.getTime() > Date.now() + 90 * DAY) return res.status(400).json({ error: "You can renew within 90 days of the end date" });
  if (ten.unit.rentKobo <= 0) return res.status(400).json({ error: "Rent is not set for this unit. Contact the landlord." });
  if (await prisma.paymentToken.findFirst({ where: { tenancyId: ten.id, kind: "RENEWAL", status: { in: [...OPEN_STATUSES] } } })) return res.status(409).json({ error: "A renewal is already in progress" });
  const t = await prisma.paymentToken.create({ data: { kind: "RENEWAL", tenancyId: ten.id, unitId: ten.unitId, tenantId: me(req), rentKobo: ten.unit.rentKobo, serviceChargeKobo: ten.unit.serviceChargeKobo, tenantNote: p.data.note } });
  await notify(await staffOf(ten.unit.propertyId), "TOKEN", "Renewal requested", `A tenant asked to renew "${ten.unit.title}".`);
  res.status(201).json({ id: t.id, status: t.status, ...breakdown(t) });
});

r.get("/mine", requireRole("TENANT"), async (req, res) => {
  const rows = await prisma.paymentToken.findMany({ where: { tenantId: me(req) }, orderBy: { createdAt: "desc" }, take: 50, include: { unit: { select: { id: true, title: true } } } });
  res.json(rows.map(tenantView));
});

// ───── Owner / manager inbox ─────
r.get("/incoming", requireRole("OWNER", "MANAGER"), async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await prisma.paymentToken.findMany({
    where: { unit: unitScope(me(req), req.user!.role), status: status ? (status as any) : { in: [...OPEN_STATUSES] } },
    orderBy: { createdAt: "desc" }, take: 100, include: tokenInclude });
  res.json(await Promise.all(rows.map((t) => staffView(t, me(req)))));
});

// ───── One token: tenant sees their own; staff see tokens on properties they manage ─────
async function visible(req: Request) {
  const t = await prisma.paymentToken.findUnique({ where: { id: req.params.id }, include: tokenInclude });
  if (!t) return null;
  const role = req.user!.role;
  if (role === "ADMIN") return { t, kind: "admin" as const };
  if (role === "TENANT") return t.tenantId === me(req) ? { t, kind: "tenant" as const } : null;
  return (await tokenRights(me(req), t.unit.propertyId)) ? { t, kind: "staff" as const } : null;
}
r.get("/:id", async (req, res) => {
  const v = await visible(req); if (!v) return res.status(404).json({ error: "Not found" });
  res.json(v.kind === "tenant" ? tenantView(v.t) : await staffView(v.t, me(req)));
});
r.get("/:id/receipt", async (req, res) => {
  const v = await visible(req); if (!v) return res.status(404).json({ error: "Not found" });
  const buf = await receiptBuffer(v.t.id); if (!buf) return res.status(409).json({ error: "A receipt exists only after payment is confirmed" });
  res.type("application/pdf").set("Content-Disposition", `inline; filename="receipt-${v.t.code}.pdf"`).send(buf);
});
r.get("/:id/proof", async (req, res) => {
  const v = await visible(req); if (!v?.t.proofKey || !/^[\w-]+\.\w+$/.test(v.t.proofKey)) return res.status(404).json({ error: "No proof uploaded" });
  await sendPrivate(res, v.t.proofKey);
});

// ───── Tenant actions ─────
// "I have paid": needs the transfer receipt or the bank's transfer reference.
r.post("/:id/claim", requireRole("TENANT"), rateLimit({ windowMs: HOUR, max: 20 }), upload.single("file"), async (req, res) => {
  const reference = z.string().max(100).optional().parse(typeof req.body?.reference === "string" ? req.body.reference.trim() || undefined : undefined);
  const t = await prisma.paymentToken.findFirst({ where: { id: req.params.id, tenantId: me(req) }, include: { unit: true } });
  if (!t) { dropUpload(req); return res.status(404).json({ error: "Not found" }); }
  if (!req.file && (reference ?? "").length < 4) return res.status(400).json({ error: "Attach your transfer receipt (JPG, PNG or PDF, up to 5MB) or enter the transfer reference" });
  const now = new Date();
  // A token the hourly job just expired can still be claimed for 24h, so a transfer made at the last minute isn't lost.
  const lapsed = t.status === "EXPIRED" && !!t.approvedAt && !!t.expiresAt && now.getTime() - t.expiresAt.getTime() < DAY;
  if (t.status !== "ACTIVE" && !lapsed) { dropUpload(req); return res.status(409).json({ error: `You can't claim payment on a request that is ${t.status.toLowerCase().replace("_", " ")}` }); }
  await persist(req.file, "private");

  let next = "PAYMENT_CLAIMED" as "PAYMENT_CLAIMED" | "DISPUTED", reason: string | undefined;
  await prisma.$transaction(async (tx) => {
    if (lapsed && t.kind === "NEW_TENANCY") {
      const again = await tx.unit.updateMany({ where: { id: t.unitId, status: "AVAILABLE" }, data: { status: "RESERVED" } });
      if (again.count === 0) { next = "DISPUTED"; reason = "The hold on this unit lapsed and it was no longer free when the tenant reported paying. Admin review needed."; }
    }
    const u = await tx.paymentToken.updateMany({ where: { id: t.id, status: t.status }, data: { status: next, claimedAt: now, claimReference: reference, proofKey: req.file?.filename, ...(next === "DISPUTED" ? { disputeReason: reason, disputedAt: now } : {}) } });
    if (u.count === 0) throw new Fail(409, "This request was just updated. Refresh and try again.");
  }).catch((e) => { dropUpload(req); throw e; });

  const prop = (await prisma.property.findUnique({ where: { id: t.unit.propertyId } }))!;
  const receivers = [...new Set([prop.ownerId, ...(t.payToUserId ? [t.payToUserId] : [])])];
  await notify(receivers, "PAYMENT", next === "DISPUTED" ? "Payment dispute" : "Tenant says they have paid", `${naira(totalOf(t))} for "${t.unit.title}" (${t.code}). Check your account and confirm receipt.`);
  if (next === "DISPUTED") await notify(await adminIds(), "DISPUTE", "Payment dispute", `Token ${t.code}: ${reason}`);
  res.json({ status: next });
});

// Add or replace proof while a payment is waiting or disputed
r.post("/:id/proof", requireRole("TENANT"), upload.single("file"), async (req, res) => {
  const t = await prisma.paymentToken.findFirst({ where: { id: req.params.id, tenantId: me(req), status: { in: ["PAYMENT_CLAIMED", "DISPUTED"] } } });
  if (!t || !req.file) { dropUpload(req); return res.status(t ? 400 : 404).json({ error: t ? "Upload a JPG, PNG or PDF up to 5MB" : "Not found" }); }
  await persist(req.file, "private");
  await prisma.paymentToken.update({ where: { id: t.id }, data: { proofKey: req.file.filename } });
  res.json({ uploaded: true });
});

r.post("/:id/cancel", requireRole("TENANT"), async (req, res) => {
  const t = await prisma.paymentToken.findFirst({ where: { id: req.params.id, tenantId: me(req) }, include: { unit: true } });
  if (!t) return res.status(404).json({ error: "Not found" });
  if (!["REQUESTED", "ACTIVE"].includes(t.status)) return res.status(409).json({ error: "This request can no longer be cancelled here. If you already paid, wait for confirmation or open a dispute." });
  await prisma.$transaction(async (tx) => {
    const u = await tx.paymentToken.updateMany({ where: { id: t.id, status: t.status }, data: { status: "CANCELLED" } });
    if (u.count === 0) throw new Fail(409, "This request was just updated. Refresh and try again.");
    if (t.status === "ACTIVE" && t.kind === "NEW_TENANCY") await releaseUnit(t.unitId, tx);
  });
  await notify(await staffOf(t.unit.propertyId), "TOKEN", "Request cancelled", `The tenant cancelled the request for "${t.unit.title}".`);
  res.json({ status: "CANCELLED" });
});

// Tenant paid, the receiver hasn't confirmed for 24h: escalate to admin
r.post("/:id/dispute", requireRole("TENANT"), async (req, res) => {
  const reason = z.string().min(5).max(500).safeParse(req.body?.reason);
  if (!reason.success) return res.status(400).json({ error: "Tell us what happened (5-500 characters)" });
  const t = await prisma.paymentToken.findFirst({ where: { id: req.params.id, tenantId: me(req), status: "PAYMENT_CLAIMED" }, include: { unit: true } });
  if (!t) return res.status(404).json({ error: "Not found" });
  if (!t.claimedAt || Date.now() - t.claimedAt.getTime() < DAY) return res.status(400).json({ error: "Give the owner 24 hours to confirm before opening a dispute" });
  await prisma.paymentToken.update({ where: { id: t.id }, data: { status: "DISPUTED", disputeReason: "Tenant: " + reason.data, disputedAt: new Date() } });
  await notify(await adminIds(), "DISPUTE", "Payment dispute", `Token ${t.code} for "${t.unit.title}": ${reason.data}`);
  res.json({ status: "DISPUTED" });
});

// ───── Owner / manager actions ─────
async function staffToken(req: Request) {
  const t = await prisma.paymentToken.findUnique({ where: { id: req.params.id }, include: tokenInclude });
  if (!t) throw new Fail(404, "Not found");
  const rights = await tokenRights(me(req), t.unit.propertyId);
  if (!rights) throw new Fail(404, "Not found");
  return { t, rights };
}

// Approve: reserves the unit, issues the code, and reveals the chosen bank account to the tenant.
r.post("/:id/approve", requireRole("OWNER", "MANAGER"), async (req, res) => {
  const p = z.object({ accountId: z.string().optional(), hours: z.number().int().min(6).max(120).optional() }).safeParse(req.body ?? {});
  if (!p.success) return res.status(400).json(p.error.flatten());
  const { t, rights } = await staffToken(req);
  if (!rights.canApprove) throw new Fail(403, "The owner has not allowed you to approve payment requests");
  if (t.status !== "REQUESTED") throw new Fail(409, `This request is already ${t.status.toLowerCase().replace("_", " ")}`);
  if (!(await isPropertyListable(t.unit.propertyId))) throw new Fail(400, "The property's yearly fee must be active before you can accept payments");
  if (t.unit.rentKobo <= 0) throw new Fail(400, "Set the rent first");

  let acc = p.data.accountId ? await accountUsable(p.data.accountId, rights.property, me(req)) : null;
  if (!p.data.accountId) {
    const mine = await defaultAccount(me(req));
    acc = mine ? await accountUsable(mine.id, rights.property, me(req)) : null;
    if (!acc && !rights.isOwner) { const o = await defaultAccount(rights.property.ownerId); acc = o ? await accountUsable(o.id, rights.property, me(req)) : null; }
  }
  if (!acc) throw new Fail(400, "No approved bank account is available to receive this payment. Add one under Payment accounts.");

  const renewal = t.kind === "RENEWAL";
  if (renewal && t.unit.status !== "OCCUPIED") throw new Fail(409, "This unit has no running tenancy");
  const now = new Date(), expiresAt = new Date(now.getTime() + (p.data.hours ?? Number(process.env.TOKEN_HOURS ?? 48)) * HOUR);
  const accNo = decrypt(acc.accountNumberEnc);

  let code = "";
  for (let i = 0; i < 5 && !code; i++) {
    const c = newCode();
    try {
      await prisma.$transaction(async (tx) => {
        if (!renewal) {
          const held = await tx.unit.updateMany({ where: { id: t.unitId, status: "AVAILABLE" }, data: { status: "RESERVED" } });
          if (held.count === 0) throw new Fail(409, "This unit is no longer available (taken down, or held for another tenant)");
        }
        const u = await tx.paymentToken.updateMany({ where: { id: t.id, status: "REQUESTED" }, data: {
          status: "ACTIVE", code: c, expiresAt, approvedById: me(req), approvedAt: now,
          // Price is re-read from the unit at approval, so the tenant pays exactly what the listing says today
          rentKobo: t.unit.rentKobo, cautionKobo: renewal ? 0 : t.unit.cautionKobo, serviceChargeKobo: t.unit.serviceChargeKobo,
          payToUserId: acc!.userId, payBankName: acc!.bankName, payAccountName: acc!.accountName, payAccountNumberEnc: encrypt(accNo) } });
        if (u.count === 0) throw new Fail(409, "This request was just updated. Refresh and try again.");
      });
      code = c;
    } catch (e: any) { if (e.code !== "P2002") throw e; } // code collision: try another
  }
  if (!code) throw new Fail(500, "Could not issue a code. Try again.");
  await prisma.enquiry.updateMany({ where: { unitId: t.unitId, tenantId: t.tenantId }, data: { contactShared: true, sharedById: me(req) } });
  const total = t.unit.rentKobo + (renewal ? 0 : t.unit.cautionKobo) + t.unit.serviceChargeKobo;
  await notify([t.tenantId], "TOKEN", "Request approved: pay now", `Pay ${naira(total)} for "${t.unit.title}" before ${expiresAt.toLocaleString("en-NG")}. Use code ${code} as the transfer narration. Open the app for the account details.`);
  res.json({ status: "ACTIVE", code, expiresAt, totalKobo: total, payTo: { name: acc.accountName, bankName: acc.bankName, last4: acc.last4 } });
});

r.post("/:id/reject", requireRole("OWNER", "MANAGER"), async (req, res) => {
  const reason = z.string().min(3).max(300).safeParse(req.body?.reason);
  if (!reason.success) return res.status(400).json({ error: "Give a short reason (shown to the tenant)" });
  const { t, rights } = await staffToken(req);
  if (!rights.canApprove) throw new Fail(403, "Not allowed");
  const u = await prisma.paymentToken.updateMany({ where: { id: t.id, status: "REQUESTED" }, data: { status: "REJECTED", rejectReason: reason.data } });
  if (u.count === 0) throw new Fail(409, "This request is no longer pending");
  await notify([t.tenantId], "TOKEN", "Request declined", `"${t.unit.title}": ${reason.data}`);
  res.json({ status: "REJECTED" });
});

// Withdraw an approved token before the tenant has paid (releases the unit)
r.post("/:id/revoke", requireRole("OWNER", "MANAGER"), async (req, res) => {
  const reason = z.string().min(3).max(300).safeParse(req.body?.reason);
  if (!reason.success) return res.status(400).json({ error: "Give a short reason (shown to the tenant)" });
  const { t, rights } = await staffToken(req);
  if (!rights.canApprove) throw new Fail(403, "Not allowed");
  await prisma.$transaction(async (tx) => {
    const u = await tx.paymentToken.updateMany({ where: { id: t.id, status: "ACTIVE" }, data: { status: "CANCELLED", rejectReason: reason.data } });
    if (u.count === 0) throw new Fail(409, "Only an approved token that is still waiting for payment can be withdrawn");
    if (t.kind === "NEW_TENANCY") await releaseUnit(t.unitId, tx);
  });
  await notify([t.tenantId], "TOKEN", "Token withdrawn", `"${t.unit.title}": ${reason.data}. Do not send any money against code ${t.code}.`);
  res.json({ status: "CANCELLED" });
});

// Confirm the money arrived. Only the owner, or the manager whose account was paid. Typing the amount prevents blind clicks.
r.post("/:id/confirm", requireRole("OWNER", "MANAGER"), async (req, res) => {
  const p = z.object({ amountKobo: z.number().int() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Enter the amount you received" });
  const { t, rights } = await staffToken(req);
  if (!(rights.isOwner || t.payToUserId === me(req))) throw new Fail(403, "Only the owner or the person whose account was paid can confirm receipt");
  if (!["PAYMENT_CLAIMED", "DISPUTED"].includes(t.status)) throw new Fail(409, "There is no payment waiting for confirmation");
  if (p.data.amountKobo !== totalOf(t)) throw new Fail(400, `The amount received must equal the total due (${naira(totalOf(t))}). If the tenant sent a different amount, use "Not received" and settle it with them.`);
  res.json({ status: "PAID", ...(await completeToken(t.id, me(req))) });
});

r.post("/:id/not-received", requireRole("OWNER", "MANAGER"), async (req, res) => {
  const note = z.string().min(3).max(500).safeParse(req.body?.note);
  if (!note.success) return res.status(400).json({ error: "Say what you see (e.g. nothing received, or a different amount)" });
  const { t, rights } = await staffToken(req);
  if (!(rights.isOwner || t.payToUserId === me(req))) throw new Fail(403, "Only the owner or the person whose account was paid can respond");
  const u = await prisma.paymentToken.updateMany({ where: { id: t.id, status: "PAYMENT_CLAIMED" }, data: { status: "DISPUTED", disputeReason: "Receiver: " + note.data, disputedAt: new Date() } });
  if (u.count === 0) throw new Fail(409, "There is no payment waiting for confirmation");
  await notify([t.tenantId], "DISPUTE", "Payment not confirmed", `The receiver could not find your payment for "${t.unit.title}": ${note.data}. Upload your transfer receipt; an admin will review if it isn't resolved.`);
  await notify(await adminIds(), "DISPUTE", "Payment dispute", `Token ${t.code} for "${t.unit.title}": receiver says: ${note.data}`);
  res.json({ status: "DISPUTED" });
});

export default r;
