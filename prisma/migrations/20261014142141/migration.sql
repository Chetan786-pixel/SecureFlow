-- DropForeignKey
ALTER TABLE "ScanJob" DROP CONSTRAINT "ScanJob_repositoryId_fkey";

-- DropForeignKey
ALTER TABLE "WebhookEvent" DROP CONSTRAINT "WebhookEvent_repositoryId_fkey";

-- CreateTable
CREATE TABLE "ArmorIQEnforcementLog" (
    "id" TEXT NOT NULL,
    "scanJobId" TEXT,
    "findingId" TEXT,
    "agentId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "ruleMatched" TEXT,
    "justification" TEXT,
    "proofHash" TEXT,
    "signature" TEXT,
    "intentId" TEXT,
    "frameworks" TEXT[] DEFAULT ARRAY['SOC 2', 'ISO 27001']::TEXT[],
    "privacyLevel" TEXT NOT NULL DEFAULT 'REDACTED',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArmorIQEnforcementLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArmorIQEnforcementLog_scanJobId_idx" ON "ArmorIQEnforcementLog"("scanJobId");

-- CreateIndex
CREATE INDEX "ArmorIQEnforcementLog_findingId_idx" ON "ArmorIQEnforcementLog"("findingId");

-- CreateIndex
CREATE INDEX "ArmorIQEnforcementLog_decision_idx" ON "ArmorIQEnforcementLog"("decision");

-- CreateIndex
CREATE INDEX "ArmorIQEnforcementLog_timestamp_idx" ON "ArmorIQEnforcementLog"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "Finding_fileLocation_idx" ON "Finding"("fileLocation");

-- CreateIndex
CREATE INDEX "Finding_scanResultId_fingerprint_idx" ON "Finding"("scanResultId", "fingerprint");

-- CreateIndex
CREATE INDEX "Finding_severity_type_idx" ON "Finding"("severity", "type");

-- CreateIndex
CREATE INDEX "Finding_promptInjectionSuspected_idx" ON "Finding"("promptInjectionSuspected");

-- CreateIndex
CREATE INDEX "FindingTriage_updatedAt_idx" ON "FindingTriage"("updatedAt" DESC);

-- CreateIndex
CREATE INDEX "PolicyTemplate_isDefault_idx" ON "PolicyTemplate"("isDefault");

-- CreateIndex
CREATE INDEX "PolicyTemplate_severity_idx" ON "PolicyTemplate"("severity");

-- CreateIndex
CREATE INDEX "PullRequest_status_idx" ON "PullRequest"("status");

-- CreateIndex
CREATE INDEX "PullRequest_state_idx" ON "PullRequest"("state");

-- CreateIndex
CREATE INDEX "PullRequest_status_state_idx" ON "PullRequest"("status", "state");

-- CreateIndex
CREATE INDEX "Repository_owner_idx" ON "Repository"("owner");

-- CreateIndex
CREATE INDEX "Repository_createdAt_idx" ON "Repository"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "ScanJob_status_leaseExpiresAt_idx" ON "ScanJob"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "ScanJob_processingToken_idx" ON "ScanJob"("processingToken");

-- CreateIndex
CREATE INDEX "ScanJob_completedAt_idx" ON "ScanJob"("completedAt");

-- CreateIndex
CREATE INDEX "ScanResult_riskScore_idx" ON "ScanResult"("riskScore");

-- CreateIndex
CREATE INDEX "ScanResult_policyDecision_createdAt_idx" ON "ScanResult"("policyDecision", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "remediation_patches_status_createdAt_idx" ON "remediation_patches"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "remediation_patches_createdAt_idx" ON "remediation_patches"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArmorIQEnforcementLog" ADD CONSTRAINT "ArmorIQEnforcementLog_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArmorIQEnforcementLog" ADD CONSTRAINT "ArmorIQEnforcementLog_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
