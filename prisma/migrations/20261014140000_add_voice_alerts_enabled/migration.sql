-- AlterTable: add voice alert opt-in preference to User (#1307)
ALTER TABLE "User" ADD COLUMN "voiceAlertsEnabled" BOOLEAN NOT NULL DEFAULT false;
