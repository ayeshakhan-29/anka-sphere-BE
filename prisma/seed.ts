import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
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

  console.log('Seed complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
