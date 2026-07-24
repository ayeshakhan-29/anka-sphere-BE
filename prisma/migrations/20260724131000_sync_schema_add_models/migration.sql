-- CreateEnum
CREATE TYPE "EmailCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RepurposeFormat" AS ENUM ('CAROUSEL', 'LINKEDIN_POST', 'EMAIL_SNIPPET', 'TWEET_THREAD', 'VIDEO_SCRIPT');

-- CreateEnum
CREATE TYPE "CommunityQueueStatus" AS ENUM ('NEEDS_RESPONSE', 'IN_PROGRESS', 'RESPONDED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "AdCreativeFormat" AS ENUM ('STATIC_IMAGE', 'VIDEO', 'CAROUSEL', 'TEXT');

-- CreateEnum
CREATE TYPE "AdCreativeStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'ACTIVE', 'PAUSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('FIRING', 'NOT_FIRING', 'UNVERIFIED', 'UNDER_REVIEW');

-- CreateEnum
CREATE TYPE "BacklinkStatus" AS ENUM ('LIVE', 'LOST', 'PENDING', 'DISAVOWED');

-- DropIndex
DROP INDEX "integration_connections_provider_key";

-- AlterTable
ALTER TABLE "content_pages" ADD COLUMN     "pillarId" TEXT;

-- AlterTable
ALTER TABLE "integration_connections" ADD COLUMN     "projectId" TEXT;

-- CreateTable
CREATE TABLE "project_google_credentials" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clientIdEnc" TEXT,
    "clientSecretEnc" TEXT,
    "developerTokenEnc" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "googleAdsAccountId" TEXT,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "connectedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_google_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_social_credentials" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "metaAppIdEnc" TEXT,
    "metaAppSecretEnc" TEXT,
    "tiktokClientKeyEnc" TEXT,
    "tiktokClientSecretEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_social_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_campaigns" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audienceSegment" TEXT,
    "subjectLines" JSONB,
    "bodyCopy" TEXT,
    "cta" TEXT,
    "sendDate" TIMESTAMP(3),
    "status" "EmailCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pillarId" TEXT,

    CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_repurposes" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourcePageId" TEXT,
    "targetFormat" "RepurposeFormat" NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_repurposes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_queue_items" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "userHandle" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "postTitle" TEXT,
    "assignedTo" TEXT,
    "status" "CommunityQueueStatus" NOT NULL DEFAULT 'NEEDS_RESPONSE',
    "responseBody" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_creatives" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "format" "AdCreativeFormat" NOT NULL DEFAULT 'STATIC_IMAGE',
    "network" "AdNetwork" NOT NULL DEFAULT 'META',
    "mediaUrl" TEXT,
    "headline" TEXT,
    "bodyCopy" TEXT,
    "targetAdSet" TEXT,
    "status" "AdCreativeStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_events" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "triggerUrl" TEXT,
    "firingRate" INTEGER DEFAULT 0,
    "status" "EventStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "lastFiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversion_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backlinks" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceDomain" TEXT NOT NULL,
    "targetPage" TEXT NOT NULL,
    "anchorText" TEXT NOT NULL,
    "daScore" INTEGER,
    "status" "BacklinkStatus" NOT NULL DEFAULT 'PENDING',
    "acquiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backlinks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword_rank_logs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "previousPos" INTEGER,
    "clusterName" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keyword_rank_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_pillars" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3B82F6',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_pillars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_google_credentials_projectId_key" ON "project_google_credentials"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_social_credentials_projectId_key" ON "project_social_credentials"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_projectId_provider_key" ON "integration_connections"("projectId", "provider");

-- AddForeignKey
ALTER TABLE "content_pages" ADD CONSTRAINT "content_pages_pillarId_fkey" FOREIGN KEY ("pillarId") REFERENCES "content_pillars"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_google_credentials" ADD CONSTRAINT "project_google_credentials_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_social_credentials" ADD CONSTRAINT "project_social_credentials_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_pillarId_fkey" FOREIGN KEY ("pillarId") REFERENCES "content_pillars"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_repurposes" ADD CONSTRAINT "content_repurposes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_repurposes" ADD CONSTRAINT "content_repurposes_sourcePageId_fkey" FOREIGN KEY ("sourcePageId") REFERENCES "content_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_queue_items" ADD CONSTRAINT "community_queue_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backlinks" ADD CONSTRAINT "backlinks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyword_rank_logs" ADD CONSTRAINT "keyword_rank_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_pillars" ADD CONSTRAINT "content_pillars_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
