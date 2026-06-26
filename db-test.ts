import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  // Let's find any project
  const project = await prisma.project.findFirst();
  if (!project) {
    console.error('No project found in database!');
    return;
  }
  console.log('Using project:', project.id, project.name);

  // Let's upsert development record
  const dev = await prisma.development.upsert({
    where: { projectId: project.id },
    update: {},
    create: { projectId: project.id },
  });
  console.log('Development ID:', dev.id);

  // Let's try to create a dev task
  const body = {
    title: 'New Task',
    status: 'SETUP',
    priority: 'MEDIUM',
    sortOrder: 1
  };

  try {
    const task = await prisma.devTask.create({
      data: {
        title: body.title,
        status: body.status as any,
        priority: body.priority as any,
        sortOrder: body.sortOrder,
        developmentId: dev.id,
      }
    });
    console.log('SUCCESS created task:', task);
    // Delete the test task
    await prisma.devTask.delete({ where: { id: task.id } });
  } catch (err) {
    console.error('DATABASE ERROR:', err);
  }
}

main().finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
