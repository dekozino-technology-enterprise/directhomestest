import "dotenv/config";
import "express-async-errors"; // lets async route handlers throw: errors reach the handler below instead of crashing the process
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import auth from "./routes/auth";
import admin from "./routes/admin";
import adminKyc from "./routes/adminKyc";
import verify from "./routes/verify";
import properties from "./routes/properties";
import adminProperties from "./routes/adminProperties";
import webhooks from "./routes/webhooks";
import units from "./routes/units";
import publicSearch from "./routes/publicSearch";
import engage from "./routes/engage";
import dashboards from "./routes/dashboards";
import accounts from "./routes/accounts";
import tokens from "./routes/tokens";
import tenancies from "./routes/tenancies";
import agreements from "./routes/agreements";
import adminPayments from "./routes/adminPayments";
import tickets from "./routes/tickets";
import vendors from "./routes/vendors";
import reviews from "./routes/reviews";
import reports from "./routes/reports";
import announcements from "./routes/announcements";
import insights from "./routes/insights";
import adminOps from "./routes/adminOps";
import adminAnalytics from "./routes/adminAnalytics";
import { runExpiryJob } from "./jobs/expiry";
import { runTokenJob } from "./jobs/tokens";
import { runTicketJob } from "./jobs/tickets";
import { Fail } from "./lib/payToken";
import { mediaHandler } from "./lib/storage";

const app = express();
app.set("trust proxy", 1); // Render sits behind a proxy: needed for correct client IPs in rate limits
app.use(helmet({ contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), "img-src": ["'self'", "data:", "blob:", ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : [])], "upgrade-insecure-requests": null } } }));
app.use(cors({ origin: process.env.WEB_ORIGIN ? process.env.WEB_ORIGIN.split(",").map((s) => s.trim()) : true })); // set WEB_ORIGIN to your Netlify URL in production
app.use("/api/webhooks", webhooks); // must be BEFORE express.json (needs raw body)
app.use(express.json({ limit: "1mb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, max: 50 })); // brute-force protection

app.get("/api/health", (_q, res) => res.json({ ok: true }));
app.use("/api/auth", auth);
app.use("/api/admin", admin);
app.use("/api/admin", adminKyc);
app.use("/api/admin", adminProperties);
app.use("/api/admin", adminPayments);
app.use("/api/admin", adminOps); // escalated tickets, review moderation, reported listings
app.use("/api/admin", adminAnalytics); // analytics + CSV exports
app.use("/api/properties", properties);
app.use("/api/verify", rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }), verify);
app.use("/admin", express.static("public/admin"));
app.get("/media/:name", mediaHandler); // public listing photos (Supabase public bucket in production)
app.use("/api/public", rateLimit({ windowMs: 60_000, max: 120 }), publicSearch);
app.use("/api/units", units);
app.use("/api", engage); // /enquiries, /viewings, /favourites
app.use("/api/accounts", accounts); // owner/manager bank accounts for receiving rent
app.use("/api/tokens", tokens); // payment token flow (direct bank transfer)
app.use("/api/tenancies", tenancies);
app.use("/api/agreements", agreements);
app.use("/api/tickets", tickets); // maintenance tickets
app.use("/api/vendors", vendors);
app.use("/api/reviews", reviews); // GET is public
app.use("/api/reports", reports); // report a listing
app.use("/api/announcements", announcements);
app.use("/api/insights", insights); // owner/manager reports
app.use("/api/dashboard", dashboards); // admin dashboard UI at /admin/
// Phase 2+: /api/owner, /api/manager, /api/tenant, /api/properties, /api/units ...

app.use((err: any, _q: express.Request, res: express.Response, _n: express.NextFunction) => {
  if (err instanceof Fail) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

runExpiryJob().catch(console.error);
setInterval(() => runExpiryJob().catch(console.error), 60 * 60 * 1000); // use a real scheduler/queue at scale
runTokenJob().catch(console.error);
setInterval(() => runTokenJob().catch(console.error), 5 * 60 * 1000); // token expiry needs minute-level timing
runTicketJob().catch(console.error);
setInterval(() => runTicketJob().catch(console.error), 60 * 60 * 1000); // ticket escalation + auto-close

app.listen(process.env.PORT || 4000, () => console.log("API running"));
