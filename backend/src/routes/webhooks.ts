import express, { Router } from "express";
import { validSignature, settlePayment, fromPaystackAmount } from "../lib/payments";

const r = Router();
// Raw body is required to verify Paystack's signature
r.post("/paystack", express.raw({ type: "*/*" }), async (req, res) => {
  if (!validSignature(req.body, req.headers["x-paystack-signature"] as string)) return res.status(401).end();
  const ev = JSON.parse(req.body.toString());
  if (ev.event === "charge.success" && ev.data?.currency === "NGN") await settlePayment(ev.data.reference, fromPaystackAmount(ev.data.amount), ev);
  res.sendStatus(200);
});
export default r;
