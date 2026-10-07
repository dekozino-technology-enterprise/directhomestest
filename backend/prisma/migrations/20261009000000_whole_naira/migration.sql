-- Money is now stored as whole naira (no fractional currency unit).
-- Each column is renamed and its existing values are converted from the old
-- hundredths-of-a-naira figures to whole naira, rounded to the nearest naira.

-- OnboardingFeeTier
ALTER TABLE "OnboardingFeeTier" RENAME COLUMN "amountKobo" TO "amountNaira";
UPDATE "OnboardingFeeTier" SET "amountNaira" = ("amountNaira" + 50) / 100 WHERE "amountNaira" IS NOT NULL;

-- PropertyOnboarding
ALTER TABLE "PropertyOnboarding" RENAME COLUMN "amountKobo" TO "amountNaira";
UPDATE "PropertyOnboarding" SET "amountNaira" = ("amountNaira" + 50) / 100 WHERE "amountNaira" IS NOT NULL;

-- Unit
ALTER TABLE "Unit" RENAME COLUMN "rentKobo" TO "rentNaira";
UPDATE "Unit" SET "rentNaira" = ("rentNaira" + 50) / 100 WHERE "rentNaira" IS NOT NULL;
ALTER TABLE "Unit" RENAME COLUMN "cautionKobo" TO "cautionNaira";
UPDATE "Unit" SET "cautionNaira" = ("cautionNaira" + 50) / 100 WHERE "cautionNaira" IS NOT NULL;
ALTER TABLE "Unit" RENAME COLUMN "serviceChargeKobo" TO "serviceChargeNaira";
UPDATE "Unit" SET "serviceChargeNaira" = ("serviceChargeNaira" + 50) / 100 WHERE "serviceChargeNaira" IS NOT NULL;

-- PaymentToken
ALTER TABLE "PaymentToken" RENAME COLUMN "rentKobo" TO "rentNaira";
UPDATE "PaymentToken" SET "rentNaira" = ("rentNaira" + 50) / 100 WHERE "rentNaira" IS NOT NULL;
ALTER TABLE "PaymentToken" RENAME COLUMN "cautionKobo" TO "cautionNaira";
UPDATE "PaymentToken" SET "cautionNaira" = ("cautionNaira" + 50) / 100 WHERE "cautionNaira" IS NOT NULL;
ALTER TABLE "PaymentToken" RENAME COLUMN "serviceChargeKobo" TO "serviceChargeNaira";
UPDATE "PaymentToken" SET "serviceChargeNaira" = ("serviceChargeNaira" + 50) / 100 WHERE "serviceChargeNaira" IS NOT NULL;
ALTER TABLE "PaymentToken" RENAME COLUMN "platformFeeKobo" TO "platformFeeNaira";
UPDATE "PaymentToken" SET "platformFeeNaira" = ("platformFeeNaira" + 50) / 100 WHERE "platformFeeNaira" IS NOT NULL;

-- Transaction
ALTER TABLE "Transaction" RENAME COLUMN "amountKobo" TO "amountNaira";
UPDATE "Transaction" SET "amountNaira" = ("amountNaira" + 50) / 100 WHERE "amountNaira" IS NOT NULL;

-- Tenancy
ALTER TABLE "Tenancy" RENAME COLUMN "rentKobo" TO "rentNaira";
UPDATE "Tenancy" SET "rentNaira" = ("rentNaira" + 50) / 100 WHERE "rentNaira" IS NOT NULL;

-- MaintenanceTicket
ALTER TABLE "MaintenanceTicket" RENAME COLUMN "estimateKobo" TO "estimateNaira";
UPDATE "MaintenanceTicket" SET "estimateNaira" = ("estimateNaira" + 50) / 100 WHERE "estimateNaira" IS NOT NULL;
ALTER TABLE "MaintenanceTicket" RENAME COLUMN "costKobo" TO "costNaira";
UPDATE "MaintenanceTicket" SET "costNaira" = ("costNaira" + 50) / 100 WHERE "costNaira" IS NOT NULL;

ALTER INDEX "Unit_rentKobo_idx" RENAME TO "Unit_rentNaira_idx";
