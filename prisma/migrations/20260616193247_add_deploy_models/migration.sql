-- CreateEnum
CREATE TYPE "WpEnv" AS ENUM ('DEV', 'STAGING', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "QueueItemStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'IN_QA', 'STAGING_DONE', 'LIVE_DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "QaStatus" AS ENUM ('NOT_STARTED', 'PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('PAGE', 'POST');
