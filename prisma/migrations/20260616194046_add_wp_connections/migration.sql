-- CreateEnum
CREATE TYPE "DeploymentLogStatus" AS ENUM ('SUCCESS', 'ERROR');

-- CreateEnum
CREATE TYPE "WPPluginStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "WPThemeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "WpAuthType" AS ENUM ('APP_PASSWORD');

-- CreateEnum
CREATE TYPE "WpConnectionStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "wp_connections" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "env" "WpEnv" NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "wpUsername" TEXT NOT NULL,
    "wpAuthType" "WpAuthType" NOT NULL DEFAULT 'APP_PASSWORD',
    "wpAppPasswordEnc" TEXT,
    "status" "WpConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wp_connections_projectId_env_key" ON "wp_connections"("projectId", "env");

-- AddForeignKey
ALTER TABLE "wp_connections" ADD CONSTRAINT "wp_connections_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
