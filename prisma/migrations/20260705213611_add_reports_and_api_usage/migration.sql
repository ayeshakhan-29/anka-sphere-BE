-- CreateEnum
CREATE TYPE "DevTaskStatus" AS ENUM ('SETUP', 'IN_DEVELOPMENT', 'IN_QA', 'STAGING', 'LIVE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'READY', 'SENT');

-- AlterTable (preserve existing task statuses while converting enum types)
ALTER TABLE "dev_tasks" ADD COLUMN "pageId" TEXT;
ALTER TABLE "dev_tasks" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "dev_tasks" ALTER COLUMN "status" TYPE "DevTaskStatus"
  USING (CASE "status"::text
    WHEN 'TODO' THEN 'SETUP'
    WHEN 'IN_PROGRESS' THEN 'IN_DEVELOPMENT'
    WHEN 'IN_REVIEW' THEN 'IN_QA'
    WHEN 'DONE' THEN 'LIVE'
    ELSE 'SETUP' END)::"DevTaskStatus";
ALTER TABLE "dev_tasks" ALTER COLUMN "status" SET DEFAULT 'SETUP';

-- AlterTable
ALTER TABLE "development" ADD COLUMN     "backupLog" JSONB,
ADD COLUMN     "changeLog" JSONB,
ADD COLUMN     "maintenanceRequests" JSONB,
ADD COLUMN     "performanceNotes" TEXT,
ADD COLUMN     "qaTemplate" JSONB,
ADD COLUMN     "uptimeLastChecked" TIMESTAMP(3),
ADD COLUMN     "uptimeResponseTime" INTEGER,
ADD COLUMN     "uptimeStatus" TEXT;

-- CreateTable
CREATE TABLE "deployment_queue_items" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contentKind" "ContentKind" NOT NULL,
    "pageId" TEXT,
    "postId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT,
    "status" "QueueItemStatus" NOT NULL DEFAULT 'QUEUED',
    "qaStatus" "QaStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "qaNotes" TEXT,
    "qaChecklist" JSONB,
    "targetEnv" "WpEnv" NOT NULL DEFAULT 'STAGING',
    "wpPostId" INTEGER,
    "wpUrl" TEXT,
    "errorMessage" TEXT,
    "deployedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployment_queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_logs" (
    "id" TEXT NOT NULL,
    "queueItemId" TEXT NOT NULL,
    "env" "WpEnv" NOT NULL,
    "status" "DeploymentLogStatus" NOT NULL,
    "requestBody" JSONB,
    "responseBody" JSONB,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "pushedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wp_plugins" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" TEXT,
    "status" "WPPluginStatus" NOT NULL DEFAULT 'INACTIVE',
    "description" TEXT,
    "lastUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wp_plugins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wp_themes" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" TEXT,
    "status" "WPThemeStatus" NOT NULL DEFAULT 'INACTIVE',
    "description" TEXT,
    "lastUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wp_themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance" (
    "id" TEXT NOT NULL,
    "uptimeStatus" TEXT NOT NULL DEFAULT 'OPERATIONAL',
    "backupLog" TEXT NOT NULL DEFAULT '',
    "performanceNotes" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "period" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT,
    "blockers" TEXT,
    "highlights" TEXT,
    "nextSteps" TEXT,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "sentTo" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_usage_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "projectId" TEXT,
    "userName" TEXT,
    "prompt" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wp_plugins_projectId_slug_key" ON "wp_plugins"("projectId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "wp_themes_projectId_slug_key" ON "wp_themes"("projectId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "reports_projectId_type_periodStart_key" ON "reports"("projectId", "type", "periodStart");

-- AddForeignKey
ALTER TABLE "dev_tasks" ADD CONSTRAINT "dev_tasks_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "content_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_queue_items" ADD CONSTRAINT "deployment_queue_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_queue_items" ADD CONSTRAINT "deployment_queue_items_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "content_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_logs" ADD CONSTRAINT "deployment_logs_queueItemId_fkey" FOREIGN KEY ("queueItemId") REFERENCES "deployment_queue_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_plugins" ADD CONSTRAINT "wp_plugins_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_themes" ADD CONSTRAINT "wp_themes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

