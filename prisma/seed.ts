import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/anka_sphere';

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

/**
 * Wait for the database to accept connections before seeding.
 * On deploys the app container often boots before the DB is ready; that
 * previously threw ECONNREFUSED and crash-looped the whole process.
 */
async function waitForDb(retries = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);
      console.warn(`DB not reachable (attempt ${attempt}/${retries}): ${reason}`);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function main() {
  await waitForDb();

  const passwordHash = await bcrypt.hash('password', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@anka.agency' },
    update: {},
    create: {
      email: 'admin@anka.agency',
      passwordHash,
      name: 'Ayesha K.',
      role: 'ADMIN',
    },
  });

  await prisma.user.upsert({
    where: { email: 'james@anka.agency' },
    update: {},
    create: { email: 'james@anka.agency', passwordHash, name: 'James D.', role: 'DEVELOPER' },
  });

  await prisma.user.upsert({
    where: { email: 'sara@anka.agency' },
    update: {},
    create: { email: 'sara@anka.agency', passwordHash, name: 'Sara M.', role: 'DESIGNER' },
  });

  await prisma.user.upsert({
    where: { email: 'liam@anka.agency' },
    update: {},
    create: { email: 'liam@anka.agency', passwordHash, name: 'Liam T.', role: 'SEO' },
  });

  // Seed a sample project
  const existing = await prisma.project.findFirst({ where: { clientName: 'Lumina Studios' } });
  if (!existing) {
    await prisma.project.create({
      data: {
        name: 'Brand Refresh & Website',
        clientName: 'Lumina Studios',
        status: 'ACTIVE',
        currentStage: 'DESIGN',
        description: 'Full brand identity refresh including new logo, colour palette, and a 6-page WordPress website.',
        startDate: new Date('2026-04-01'),
        targetDate: new Date('2026-06-30'),
        createdById: admin.id,
        pipeline: {
          create: [
            { stage: 'PROFILING',       status: 'APPROVED',     approvedAt: new Date('2026-04-10') },
            { stage: 'WRITTEN_CONTENT', status: 'APPROVED',     approvedAt: new Date('2026-04-25') },
            { stage: 'DESIGN',          status: 'IN_PROGRESS',  startedAt: new Date('2026-04-26') },
            { stage: 'DEVELOPMENT',     status: 'LOCKED' },
            { stage: 'MARKETING',       status: 'LOCKED' },
          ],
        },
        milestones: {
          create: [
            { label: 'Client brief sign-off',     status: 'DONE',    sortOrder: 1 },
            { label: 'Brand inputs submitted',    status: 'DONE',    sortOrder: 2 },
            { label: 'Profiling complete (Hard Gate)', status: 'DONE', sortOrder: 3 },
            { label: 'Written content approved',  status: 'DONE',    sortOrder: 4 },
            { label: 'Design concepts delivered', status: 'PENDING', sortOrder: 5 },
          ],
        },
      },
    });
  }

  // Seed a demo project at the Marketing stage so Growth dashboards have data
  const growthExisting = await prisma.project.findFirst({ where: { clientName: 'Verdant Foods' } });
  if (!growthExisting) {
    await prisma.project.create({
      data: {
        name: 'Post-Launch Growth Campaign',
        clientName: 'Verdant Foods',
        status: 'ACTIVE',
        currentStage: 'MARKETING',
        description: 'Organic social, content marketing, and paid campaigns for the newly launched Verdant Foods e-commerce site.',
        startDate: new Date('2026-02-10'),
        targetDate: new Date('2026-09-30'),
        createdById: admin.id,
        pipeline: {
          create: [
            { stage: 'PROFILING',       status: 'APPROVED',    approvedAt: new Date('2026-02-20') },
            { stage: 'WRITTEN_CONTENT', status: 'APPROVED',    approvedAt: new Date('2026-03-15') },
            { stage: 'DESIGN',          status: 'APPROVED',    approvedAt: new Date('2026-04-10') },
            { stage: 'DEVELOPMENT',     status: 'APPROVED',    approvedAt: new Date('2026-05-25') },
            { stage: 'MARKETING',       status: 'IN_PROGRESS', startedAt: new Date('2026-06-01') },
          ],
        },
        milestones: {
          create: [
            { label: 'Website launched',            status: 'DONE',    sortOrder: 1 },
            { label: 'Growth strategy approved',    status: 'DONE',    sortOrder: 2 },
            { label: 'First month social calendar', status: 'DONE',    sortOrder: 3 },
            { label: 'Paid campaigns live',         status: 'PENDING', sortOrder: 4 },
            { label: 'First monthly report',        status: 'PENDING', sortOrder: 5 },
          ],
        },
        marketing: {
          create: {
            strategy: 'Build brand awareness through organic social and food-blogger collaborations, then scale winning content with paid campaigns.',
            targetAudience: 'Health-conscious home cooks aged 25–45, urban, active on Instagram and TikTok.',
            budget: '$4,500 / month',
            channels: 'Instagram, TikTok, Facebook, LinkedIn',
            notes: 'Client wants weekly Reels; avoid stock photography — use launch shoot assets from the Design library.',
            tasks: {
              create: [
                { title: 'Instagram launch announcement post',       category: 'SOCIAL',    status: 'DONE',        priority: 'HIGH',   assigneeName: 'Mina R.',  sortOrder: 1 },
                { title: 'Recipe Reel — 5-minute lunch bowls',       category: 'SOCIAL',    status: 'DONE',        priority: 'MEDIUM', assigneeName: 'Mina R.',  sortOrder: 2 },
                { title: 'TikTok behind-the-scenes kitchen tour',    category: 'SOCIAL',    status: 'IN_PROGRESS', priority: 'HIGH',   assigneeName: 'Mina R.',  sortOrder: 3 },
                { title: 'Founder story carousel (IG + LinkedIn)',   category: 'SOCIAL',    status: 'IN_PROGRESS', priority: 'MEDIUM', assigneeName: 'Omar S.',  sortOrder: 4 },
                { title: 'July content calendar — week 3 posts',     category: 'SOCIAL',    status: 'IN_REVIEW',   priority: 'MEDIUM', assigneeName: 'Mina R.',  sortOrder: 5 },
                { title: 'Community replies + DM triage (weekly)',   category: 'SOCIAL',    status: 'TODO',        priority: 'LOW',    assigneeName: 'Omar S.',  sortOrder: 6 },
                { title: 'Hashtag research — seasonal produce',      category: 'SOCIAL',    status: 'TODO',        priority: 'LOW',    assigneeName: 'Mina R.',  sortOrder: 7 },
                { title: 'Blog post — meal-prep guide',              category: 'CONTENT',   status: 'IN_PROGRESS', priority: 'MEDIUM', assigneeName: 'Hana K.',  sortOrder: 8 },
                { title: 'Email — launch week newsletter',           category: 'CONTENT',   status: 'DONE',        priority: 'HIGH',   assigneeName: 'Hana K.',  sortOrder: 9 },
                { title: 'Meta ads — retargeting creative set',      category: 'PAID',      status: 'TODO',        priority: 'HIGH',   assigneeName: 'Adil B.',  sortOrder: 10 },
                { title: 'Google Ads — brand search campaign',       category: 'PAID',      status: 'IN_PROGRESS', priority: 'MEDIUM', assigneeName: 'Adil B.',  sortOrder: 11 },
                { title: 'On-page SEO pass — product pages',         category: 'SEO',       status: 'IN_REVIEW',   priority: 'MEDIUM', assigneeName: 'Liam T.',  sortOrder: 12 },
                { title: 'GA4 conversion events audit',              category: 'ANALYTICS', status: 'TODO',        priority: 'MEDIUM', assigneeName: 'Liam T.',  sortOrder: 13 },
              ],
            },
          },
        },
      },
    });
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
