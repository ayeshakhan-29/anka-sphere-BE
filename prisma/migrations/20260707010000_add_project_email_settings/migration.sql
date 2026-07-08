CREATE TYPE "EmailProvider" AS ENUM ('RESEND', 'POSTMARK', 'SENDGRID', 'MAILGUN', 'CUSTOM_SMTP');

CREATE TYPE "EmailDomainStatus" AS ENUM ('PENDING_DNS', 'ACTIVE');

CREATE TABLE "project_email_settings" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" "EmailProvider" NOT NULL DEFAULT 'RESEND',
    "domain" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "replyToEmail" TEXT,
    "status" "EmailDomainStatus" NOT NULL DEFAULT 'PENDING_DNS',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_email_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_email_settings_projectId_key" ON "project_email_settings"("projectId");

ALTER TABLE "project_email_settings" ADD CONSTRAINT "project_email_settings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;