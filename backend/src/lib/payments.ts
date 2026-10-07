import crypto from "crypto";
import { prisma } from "./prisma";
import { addMonths, graceEnd } from "./fees";

export const paystackConfigured = () => !!process.env.PAYSTACK_SECRET_KEY;

// Paystack's API takes amounts as an integer in the currency's smallest unit (100 per naira).
// This is the only place that unit exists; everything else in the app is whole naira.
export const PAYSTACK_UNITS_PER_NAIRA = 100;
export const fromPaystackAmount = (amount: number) => amount / PAYSTACK_UNITS_PER_NAIRA;

export async function initCheckout(email: string, amountNaira: number, reference: string, meta: object) {
  // Paystack must return the user to the static frontend, not the API host. WEB_ORIGIN
  // may list multiple allowed browser origins; use the primary one for the callback.
  const callbackUrl = process.env.WEB_ORIGIN?.split(",")[0]?.trim();
  const r = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, amount: amountNaira * PAYSTACK_UNITS_PER_NAIRA, reference, currency: "NGN", ...(callbackUrl ? { callback_url: callbackUrl } : {}), metadata: meta }),
  });
  const d: any = await r.json();
  if (!r.ok || !d.status) throw new Error("Could not start payment");
  return d.data.authorization_url as string;
}

export function validSignature(raw: Buffer, sig?: string) {
  if (!sig || !process.env.PAYSTACK_SECRET_KEY) return false;
  const h = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(raw).digest("hex");
  return h.length === sig.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(sig));
}

// Idempotent: safe if Paystack retries the webhook. Amount is checked against OUR record, never the client's.
export async function settlePayment(reference: string, paidNaira: number, payload?: object) {
  const tx = await prisma.transaction.findUnique({ where: { reference } });
  if (!tx) return "unknown";
  if (paidNaira !== tx.amountNaira) { await prisma.transaction.updateMany({ where: { id: tx.id, status: "PENDING" }, data: { status: "FAILED", rawWebhook: payload as any } }); return "mismatch"; }
  const claim = await prisma.transaction.updateMany({ where: { id: tx.id, status: { not: "SUCCESS" } }, data: { status: "SUCCESS", rawWebhook: payload as any } });
  if (claim.count === 0) return "duplicate";

  const ob = await prisma.propertyOnboarding.findUnique({ where: { transactionId: tx.id } });
  if (ob) {
    const now = new Date();
    if (tx.purpose === "RENEWAL") {
      const prev = ob.renewedFromId ? await prisma.propertyOnboarding.findUnique({ where: { id: ob.renewedFromId } }) : null;
      const start = prev?.expiresAt && prev.expiresAt > now ? prev.expiresAt : now; // no days lost on early renewal
      const exp = addMonths(start, 12);
      await prisma.$transaction([
        prisma.propertyOnboarding.update({ where: { id: ob.id }, data: { paidAt: now, approvedAt: now, startsAt: start, expiresAt: exp, graceEndsAt: graceEnd(exp) } }),
        prisma.property.update({ where: { id: ob.propertyId }, data: { status: "ACTIVE" } }),
      ]);
    } else {
      const exp = addMonths(now, 12); // first year starts when the owner pays and the property goes live
      await prisma.$transaction([
        prisma.propertyOnboarding.update({ where: { id: ob.id }, data: { paidAt: now, approvedAt: now, startsAt: now, expiresAt: exp, graceEndsAt: graceEnd(exp) } }),
        prisma.property.updateMany({ where: { id: ob.propertyId, status: "VERIFIED" }, data: { status: "ACTIVE" } }),
      ]);
    }
  }
  await prisma.notification.create({ data: { userId: tx.userId, type: "PAYMENT", title: "Payment received", body: `We received your payment (${reference}). Your property is now live.` } });
  return "ok";
}
