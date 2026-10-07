# House Management API

Stack: Node.js 22 + Express + TypeScript + Prisma + PostgreSQL.

> The feature-phase notes below are a development history. Fresh installs use the committed baseline migration under `prisma/migrations/`; do not replay the old per-phase migration commands on top of it.

## Run
1. `cp .env.example .env` and set the database URLs, JWT secrets, admin email/password, and `DATA_ENC_KEY`.
2. Use a development PostgreSQL database (not production), then run `npm ci`.
3. `npx prisma migrate dev` (applies the committed baseline to the development database).
4. `npm run db:seed` (creates admin, unit types, features, starter fee tiers, Lagos).
5. `npm run dev` (http://localhost:4000/api/health).

## Folder structure
prisma/schema.prisma   full database (all phases)
prisma/seed.ts         admin + reference data
src/server.ts          app setup, security middleware, route mounting
src/middleware/auth.ts requireAuth + requireRole (RBAC)
src/lib/               prisma client, JWT helpers, audit logger
src/routes/auth.ts     register (TENANT/OWNER/MANAGER), login, refresh, me
src/routes/admin.ts    features, unit types, locations, fee tiers, users, audit log

## Phase 1 endpoints
POST /api/auth/register | /login | /refresh      GET /api/auth/me
(Admin only, all under /api/admin)
GET/POST/PATCH/DELETE  /features  /unit-types
GET/POST/PATCH         /locations  /fee-tiers
GET                    /users?role=&status=&q=   PATCH /users/:id/status
GET                    /audit-logs

## Phase 2 (added)
POST /api/verify/otp/send | /otp/confirm      (email + phone; DEV: code prints in server console)
POST /api/verify/upload  (multipart "file", owner/manager; stored in private-uploads/, never public)
POST /api/verify/kyc     GET /api/verify/kyc/status
Admin: GET /api/admin/stats | /kyc | /kyc/:id | /files/:key   POST /api/admin/kyc/:id/decision

## Admin dashboard
Open http://localhost:4000/admin/ and sign in with the seeded admin account.
Pages: Overview, Verification queue, Users, Features, Unit types, Locations, Onboarding fees, Audit log.

## Before production
- Run `npx prisma migrate dev --name phase2` (adds OtpCode table)
- Plug an SMS/email provider into src/lib/otp.ts
- Move uploads to private S3/Cloudinary storage; serve admin UI over HTTPS
- Optional: BVN/NIN API check (Smile ID, Dojah, Prembly) to set apiVerified

## Phase 3 (added)
Owner (all need a VERIFIED owner): POST /api/properties | GET /mine | GET /:id
POST /:id/documents {docType,fileKey}   POST /:id/pay   POST /:id/submit   POST /:id/renew
POST /:id/managers {managerEmail,authorisationKey}   DELETE /:id/managers/:managerId
Dev only (NODE_ENV=development, no Paystack key): POST /:id/pay/simulate {reference}
Webhook: POST /api/webhooks/paystack (signature-verified, idempotent)  -> set this URL in the Paystack dashboard
Admin: GET /api/admin/properties?status= | /properties/:id   POST .../documents/:docId/decision, /properties/:id/decision, /extend, /revoke, /authorisations/:id/decision
Job: src/jobs/expiry.ts hourly (renewal reminders 60/30/14/7/1 days, hide after grace period)

Property flow (verify first, then pay):
  DRAFT -> DOCS_UPLOADED -> PENDING_REVIEW -> VERIFIED -> (owner pays yearly fee) -> ACTIVE (visible, 12 months) -> EXPIRED -> renew
  Side exits: NEEDS_CHANGES (fix + resubmit), REJECTED. Nobody pays before verification, so no refunds are needed.
Estates:
  - kind ESTATE = an estate owned by ONE person. One verification and one yearly fee (admin tiers by unit count) cover all houses in it.
    The owner adds houses with POST /api/properties/:id/houses and manages them all from one dashboard.
  - Houses in an estate with MANY owners: each owner registers their own HOUSE (optional estateName) and pays the HOUSE fee.
src/lib/listing.ts isPropertyListable() is the visibility rule for Phase 4 search.
Run `npx prisma migrate dev --name verify_then_pay` (PropertyStatus enum changed, Property.estateName added; dev data with old statuses should be reset).

## Phase 4 (added)
Owner/manager: POST /api/units/images (photo) | POST /api/units | PATCH /api/units/:id | POST /:id/publish | /:id/unpublish | GET /mine?propertyId=&status=
  - Unit count is capped at the property's declaredUnits (the estate's, for houses inside an estate).
  - Managers need canListUnits; only owners (or managers with canSetPrice) can set rent. Publishing needs rent > 0 and 3+ photos.
Public search (no login): GET /api/public/meta | /locations?parentId= | /units?locationId=&q=&estate=&unitTypeId=&minRent=&maxRent=&bedrooms=&bathrooms=&furnished=&featureIds=a,b&sort=&page=
  GET /api/public/units/:id   (only live units: AVAILABLE + property ACTIVE + fee current + owner verified)
Tenant: POST /api/enquiries | GET /api/enquiries/mine | GET/POST /api/enquiries/:id/messages | POST /api/enquiries/:id/share-contact (staff)
  POST /api/viewings | GET /viewings/mine | POST /viewings/:id/action {confirm|reschedule|accept|complete|cancel}
  POST/DELETE/GET /api/favourites
Dashboards: GET /api/dashboard/staff (owner+manager, estate roll-up) | /tenant | /notifications | POST /notifications/read
Run `npx prisma migrate dev --name phase4` (adds Enquiry.sharedById). Chat is polling-based; add Socket.io later for live push.

## Phase 5 (added): payment tokens, paid directly to the owner/manager
**Money never touches the platform.** The tenant transfers rent to the owner's (or an allowed manager's) bank account. The platform keeps the record and earns only from the landlord's yearly onboarding fee. There is no escrow and no Paystack for rent.

Flow:
  1. Tenant finds a live unit, registers, verifies their phone, and requests a token: POST /api/tokens/request {unitId, moveInDate?, note?}
  2. Owner (or a manager with canApproveTokens) approves: POST /api/tokens/:id/approve {accountId?, hours?}
     -> unit becomes RESERVED (gone from search), a code like HM-K7QX2M is issued, and ONLY NOW the tenant can see the account name/number, the exact total and the deadline (default 48h)
  3. Tenant pays by bank transfer using the code as narration, then reports it: POST /api/tokens/:id/claim (multipart: reference and/or file = transfer receipt)
  4. The receiver checks their bank and confirms: POST /api/tokens/:id/confirm {amountNaira}  (must equal the total due)
     -> unit OCCUPIED, tenancy created (length from the unit's payment duration), agreement PDF saved, receipt available, competing requests auto-cancelled, ledger row written (channel BANK_TRANSFER)

Token states: REQUESTED -> ACTIVE -> PAYMENT_CLAIMED -> PAID, with side exits REJECTED, CANCELLED, EXPIRED, DISPUTED.
  - ACTIVE not paid by the deadline -> EXPIRED, unit back on the market (job runs every 5 min). A tenant who really paid late can still claim within 24h: the unit is re-held if still free, otherwise it goes to DISPUTED for an admin.
  - Receiver says "not received" (POST /:id/not-received), tenant waits 24h and disputes (POST /:id/dispute), or the receiver is silent for 48h -> DISPUTED. Admin: GET /api/admin/tokens, POST /api/admin/tokens/:id/resolve {outcome: CONFIRM_PAID|CANCEL, notes}. Cancelling frees the unit; any refund is settled between tenant and owner, because the platform holds nothing.
  - A disputed token can never take over a unit that is currently held for another tenant.

Other endpoints
  Payee accounts (owner/manager, must be KYC-verified): POST/GET /api/accounts, POST /:id/default, DELETE /:id
    Account numbers are AES-256-GCM encrypted (DATA_ENC_KEY). The name must match the verified name or an admin reviews it; an account number already used by another user is also sent to review.
    Admin: GET /api/admin/accounts, GET /accounts/:id/reveal (audited), POST /accounts/:id/decision
  Tenant: GET /api/tokens/mine | /:id | /:id/receipt (PDF) | POST /:id/cancel | /:id/proof | POST /api/tokens/renew {tenancyId}
  Owner/manager: GET /api/tokens/incoming?status= | POST /:id/reject {reason} | /:id/revoke {reason} (before payment only)
  Tenancies: GET /api/tenancies/mine | /:id/agreement (PDF) | POST /:id/confirm-move-in (tenant) | POST /:id/end {relist?} (owner/approver)
  Managers: PATCH /api/properties/:id/managers/:managerId {canApproveTokens, canReceivePayments, ...}. A manager's own account can be used only if the owner set canReceivePayments.
  Renewals: tenant requests, owner approves, tenant pays, owner confirms; the end date moves forward by one period from the old end date (no days lost). Reminders go out 60/30/14/7/1 days before the end.

Setup: add DATA_ENC_KEY to .env (openssl rand -hex 32), then `npm install` and `npx prisma migrate dev --name phase5`.
  Prisma may warn it will drop PaymentToken.issuedById and two PaymentStatus values. That is expected: no tokens existed before this phase.
Test: `TEST_DATABASE_URL=postgresql://.../myapp_test npx ts-node tests/phase5.e2e.ts` runs 79 checks through the real HTTP routes (use an empty throwaway database whose name contains "test").

Before launch
  - Have a Nigerian property lawyer review the agreement text in src/lib/pdf.ts. Some states (e.g. Lagos) limit how much advance rent and caution deposit a landlord may demand, so check what your unit prices and fee fields allow.
  - Plug real SMS/email into src/lib/otp.ts (tenants must verify their phone before requesting a token).
  - The chat contact-masking from Phase 4 protected a per-payment cut. Revenue is now the yearly fee, so you can relax it. Approving a token already shares contact for that tenant.

## Fixes made while building Phase 5
  - Registration was broken: the plaintext password field was passed to the database insert, which Prisma rejects. Fixed in src/routes/auth.ts.
  - PropertyOnboarding had no createdAt, but two routes sorted by it (admin property page, owner property page). Added.
  - Async route errors could crash the server (Express 4 doesn't catch them). Added express-async-errors.

## Phase 6 (added): maintenance, reviews, reports, announcements, analytics
Setup: `npm install`, then `npx prisma migrate dev --name phase6`. Prisma may warn it will drop `MaintenanceTicket.vendorName` and `TicketAttachment.url` (replaced by `vendorId` and `fileKey`). That is expected, no tickets existed before this phase. Optional .env keys: `TICKET_SLA_DAYS` (default 7), `REPORT_HIDE_THRESHOLD` (default 3).
Test: `TEST_DATABASE_URL=postgresql://.../myapp_test npx ts-node tests/phase6.e2e.ts` (empty throwaway database whose name contains "test").

Maintenance tickets (/api/tickets)
  Tenant (needs an ACTIVE tenancy on the unit): POST / {unitId, category, title, description, urgency} | GET /mine | POST /:id/confirm | POST /:id/reopen {reason}
  Owner/manager (their properties only): GET /staff?status=active|OPEN|...&urgency=&propertyId=&unitId=&escalated=true&page= | POST /:id/status {ACKNOWLEDGED|IN_PROGRESS|RESOLVED, note?} | PATCH /:id {vendorId, estimateNaira, costNaira, urgency}
  Everyone involved (tenant who raised it, property staff, admin): GET /:id | POST /:id/comments {body, internal?} | POST /:id/files (multipart "file", phase BEFORE|AFTER|UPDATE, staff only for AFTER/UPDATE) | GET /:id/files/:attId
  Categories: PLUMBING, ROOFING_LEAKAGE, ELECTRICAL, WATER_PUMP, SANITATION, SECURITY, APPLIANCE, OTHER. Photos JPG/PNG/WEBP up to 5MB, video MP4 up to 20MB, 12 files per ticket, stored privately.
  Status flow: OPEN -> ACKNOWLEDGED -> IN_PROGRESS -> RESOLVED -> CLOSED (tenant confirms) or REOPENED. The tenant can reopen a resolved ticket, or one closed in the last 7 days.
  Internal notes (internal:true) are visible to staff and admin only. Tenants never see costs, estimates or the vendor's phone.
  Vendors: GET/POST /api/vendors {propertyId, name, trade, phone} | DELETE /:id. Vendors belong to the property owner; managers can add and use them for properties they manage.
  Job (src/jobs/tickets.ts, hourly): escalate to admin when a ticket is still unresolved after its SLA (emergency 1 day, high 3, medium TICKET_SLA_DAYS, low double). The clock restarts when a ticket is reopened. A ticket marked resolved that the tenant ignores for 7 days is closed.
  Admin: GET /api/admin/tickets (escalated and open by default; ?status=all&escalated=false for everything) | POST /api/admin/tickets/:id/mediate {note, forceStatus?} (audited, clears the escalation).

Reviews (/api/reviews)
  Public: GET /unit/:unitId | GET /property/:propertyId (includes houses inside an estate). Reviewers show as "Ngozi B."; no contact details.
  Tenant: POST / {unitId, rating 1-5, managerRating?, comment?}. Allowed after a confirmed move-in or finished tenancy (verifiedStay true), or after a COMPLETED viewing. One review per tenant per unit; posting again updates it. DELETE /:id removes your own.
  Owner/manager: POST /:id/reply {reply}. Admin: GET /api/admin/reviews?hidden= | POST /api/admin/reviews/:id/hide {hidden, reason} (audited).

Report a listing: POST /api/reports {unitId, reason, details?} (reasons: FAKE_LISTING, ALREADY_RENTED, WRONG_PRICE, ASKED_TO_PAY_OFF_PLATFORM, SCAM_OR_FRAUD, OTHER). One report per person per listing. At REPORT_HIDE_THRESHOLD open reports the unit is hidden from search, enquiries and tokens (Unit.flaggedAt, enforced in liveConds) and admins are told.
  Admin: GET /api/admin/reports | POST /api/admin/reports/:unitId/resolve {action: DISMISS|TAKE_DOWN, note}. DISMISS brings the listing back; TAKE_DOWN sends an available unit back to DRAFT. To ban the owner use the Users page.

Announcements: staff POST /api/announcements {propertyId, title, body} (an estate notice reaches every house inside it) | GET /property/:id. Tenant: GET /mine (house and estate notices for where they live now).

Notifications: GET /api/dashboard/notifications?unread=true&type=&page= | POST /read | DELETE /:id. Dashboards now show open ticket counts (staff dashboard also shows escalated ones).

Reports and analytics
  Owner/manager: GET /api/insights/summary?from=&to= (occupancy, vacant units, tenancies ending soon, maintenance by status/category, average fix time, costs, recurring faults, rent confirmed by month and property) | GET /api/insights/export/rent.csv | /tickets.csv
    A manager sees rent figures and can export rent only on properties where the owner ticked canViewPayouts.
  Admin: GET /api/admin/analytics/overview (users by role, properties, units, occupancy, yearly fee revenue by month, rent volume recorded, tickets, open reports, disputes) | /analytics/by-state | /analytics/recurring-issues | GET /api/admin/export/onboarding.csv | rent.csv | tickets.csv | users.csv (?from=&to=, each download is audited)
  "Rent recorded" is rent the platform has a confirmed record of, not money it holds. All CSV cells that start with = + - @ are neutralised so they can't run as spreadsheet formulas.

Not in Phase 6: PDF exports (CSV only), live push for notifications, email/SMS delivery of notifications (still in-app only), an admin screen for these tools, and unit tests of the ticket SLA clock beyond the e2e script.

## Deployment setup
- Files go to Supabase Storage when `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` are set; without them, development uses local disk.
- The repository includes a baseline Prisma migration for the current schema. The free-test Render start command runs `prisma migrate deploy`, then the idempotent seed, before starting the API (it repeats on wake/restart).
- For production, move `prisma migrate deploy` to Render's paid pre-deploy command and seed once. For later schema changes, use `npx prisma migrate dev --name <change_name>` against a development database and commit the generated `prisma/migrations/` directory. Do not run `migrate dev` against production.
- OTP codes are delivered by Termii (SMS) and Resend (email) when configured. In the test Blueprint, development OTP codes are logged instead. The Node API is configured for Node 22.
- See the root README for free-test and production deployment steps.

## Phase 9 (added)
GET /api/units/:id (staff edit data) | DELETE /api/units/:id (no history, not reserved/occupied) | PATCH /api/properties/:id (name/address only before review) | DELETE /api/properties/:id (only draft/rejected, no units).
Run `npm ci`, `npx prisma generate`, and `npm run build` after changing dependencies or the Prisma schema.
