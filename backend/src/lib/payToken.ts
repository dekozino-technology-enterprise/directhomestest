import crypto from "crypto";
import { PayDuration, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { addMonths } from "./fees";
import { notify, staffOf } from "./access";
import { writeAgreement } from "./pdf";

export const MONTHS: Record<PayDuration, number> = { MONTHLY: 1, QUARTERLY: 3, BIANNUAL: 6, ANNUAL: 12 };
export const totalOf = (t: { rentNaira: number; cautionNaira: number; serviceChargeNaira: number; platformFeeNaira: number }) =>
  t.rentNaira + t.cautionNaira + t.serviceChargeNaira + t.platformFeeNaira;
export const naira = (n: number) => "₦" + n.toLocaleString("en-NG", { maximumFractionDigits: 0 });
export const breakdown = (t: Parameters<typeof totalOf>[0]) => ({ rentNaira: t.rentNaira, cautionNaira: t.cautionNaira, serviceChargeNaira: t.serviceChargeNaira, totalNaira: totalOf(t) });
export const OPEN_STATUSES = ["REQUESTED", "ACTIVE", "PAYMENT_CLAIMED", "DISPUTED"] as const;

// Short code the tenant writes as the transfer narration: no 0/O/1/I so it survives being read aloud or typed from a screenshot.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newCode = () => "HM-" + Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");

export class Fail extends Error { constructor(public status: number, msg: string) { super(msg); } }

export async function adminIds() {
  return (await prisma.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } })).map((u) => u.id);
}

// Who may approve requests / confirm money received on this property.
export async function tokenRights(userId: string, propertyId: string) {
  const p = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!p) return null;
  if (p.ownerId === userId) return { property: p, isOwner: true, canApprove: true, canReceive: true };
  const a = await prisma.managerAssignment.findFirst({ where: { managerId: userId, active: true, propertyId: { in: [p.id, ...(p.parentId ? [p.parentId] : [])] } } });
  return a ? { property: p, isOwner: false, canApprove: a.canApproveTokens, canReceive: a.canReceivePayments } : null;
}

// A receiving account may be used for a property only if it is approved, active, and belongs to the owner
// or to a manager the owner allowed to receive payments. A manager approving a request may only pick their own or the owner's account.
export async function accountUsable(accountId: string, property: { id: string; parentId: string | null; ownerId: string }, approverId: string) {
  const acc = await prisma.receivingAccount.findUnique({ where: { id: accountId } });
  if (!acc || !acc.active || acc.status !== "APPROVED") return null;
  if (acc.userId === property.ownerId) return acc;
  if (approverId !== property.ownerId && acc.userId !== approverId) return null;
  const a = await prisma.managerAssignment.findFirst({ where: { managerId: acc.userId, active: true, canReceivePayments: true, propertyId: { in: [property.id, ...(property.parentId ? [property.parentId] : [])] } } });
  return a ? acc : null;
}
export async function defaultAccount(userId: string) {
  return prisma.receivingAccount.findFirst({ where: { userId, active: true, status: "APPROVED" }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
}

// Put a RESERVED unit back on the market (never touches OCCUPIED units).
export const releaseUnit = (unitId: string, tx: Prisma.TransactionClient | typeof prisma = prisma) =>
  tx.unit.updateMany({ where: { id: unitId, status: "RESERVED" }, data: { status: "AVAILABLE" } });

// Release the unit after cancelling a token, but only if no other token on it could be the one holding it.
// (A lapsed, disputed token must never free a unit that has since been held for someone else.)
export async function releaseIfFree(tokenId: string, unitId: string, tx: Prisma.TransactionClient) {
  const others = await tx.paymentToken.count({ where: { unitId, id: { not: tokenId }, kind: "NEW_TENANCY", status: { in: ["ACTIVE", "PAYMENT_CLAIMED", "DISPUTED"] } } });
  if (!others) await releaseUnit(unitId, tx);
}

// The receiver (or an admin settling a dispute) confirms the money arrived.
// Everything happens in one transaction and is safe to call twice: the status claim below only succeeds once.
export async function completeToken(tokenId: string, confirmerId: string) {
  const out = await prisma.$transaction(async (tx) => {
    const t = await tx.paymentToken.findUnique({ where: { id: tokenId }, include: { unit: true } });
    if (!t) throw new Fail(404, "Not found");
    const claim = await tx.paymentToken.updateMany({ where: { id: t.id, status: { in: ["PAYMENT_CLAIMED", "DISPUTED"] } }, data: { status: "PAID", confirmedById: confirmerId, confirmedAt: new Date() } });
    if (claim.count === 0) throw new Fail(409, "This payment has already been handled");
    const total = totalOf(t), months = MONTHS[t.unit.payDuration], now = new Date();
    let tenancyId: string;

    if (t.kind === "NEW_TENANCY") {
      // A disputed token may no longer be the one holding the unit. If any other payment is open on it, settle that one first.
      if (t.status === "DISPUTED" && (await tx.paymentToken.count({ where: { unitId: t.unitId, id: { not: t.id }, kind: "NEW_TENANCY", status: { in: ["ACTIVE", "PAYMENT_CLAIMED", "DISPUTED"] } } })) > 0)
        throw new Fail(409, "Another payment is open on this unit. Resolve or withdraw it first, then confirm this one.");
      // RESERVED is the normal case. AVAILABLE happens when an admin settles a dispute after the hold lapsed. OCCUPIED means someone else got in.
      const u = await tx.unit.updateMany({ where: { id: t.unitId, status: { in: ["RESERVED", "AVAILABLE"] } }, data: { status: "OCCUPIED" } });
      if (u.count === 0) throw new Fail(409, "The unit is no longer free. Cancel this token instead.");
      const startsAt = t.moveInDate && t.moveInDate > now ? t.moveInDate : now;
      const ten = await tx.tenancy.create({ data: { unitId: t.unitId, tenantId: t.tenantId, tokenId: t.id, rentNaira: t.rentNaira, payDuration: t.unit.payDuration, startsAt, endsAt: addMonths(startsAt, months) } });
      tenancyId = ten.id;
      await tx.paymentToken.updateMany({ where: { unitId: t.unitId, id: { not: t.id }, status: "REQUESTED" }, data: { status: "CANCELLED", rejectReason: "This unit has been rented to another applicant" } });
    } else {
      const ten = t.tenancyId ? await tx.tenancy.findFirst({ where: { id: t.tenancyId, active: true } }) : null;
      if (!ten) throw new Fail(409, "The tenancy being renewed is no longer active");
      await tx.tenancy.update({ where: { id: ten.id }, data: { endsAt: addMonths(ten.endsAt > now ? ten.endsAt : now, months), renewedCount: { increment: 1 } } });
      tenancyId = ten.id;
    }
    await tx.transaction.create({ data: { userId: t.tenantId, purpose: t.kind === "RENEWAL" ? "RENEWAL" : "RENT", reference: t.code ?? t.id, amountNaira: total, status: "SUCCESS", channel: "BANK_TRANSFER", tokenId: t.id, confirmedById: confirmerId } });
    return { t, tenancyId, total };
  });

  const { t, tenancyId, total } = out;
  const staff = await staffOf(t.unit.propertyId);
  await notify([t.tenantId], "PAYMENT", "Payment confirmed", t.kind === "RENEWAL" ? `Your renewal for "${t.unit.title}" is confirmed.` : `Your payment of ${naira(total)} for "${t.unit.title}" is confirmed. The unit is yours. Your receipt is ready, and your landlord will issue your tenancy agreement.`);
  await notify(staff, "PAYMENT", "Rent payment confirmed", `${naira(total)} for "${t.unit.title}" (${t.code}).${t.kind === "NEW_TENANCY" ? " Open Agreements to issue the tenancy agreement to this tenant." : ""}`);
  return { tenancyId, totalNaira: total };
}
