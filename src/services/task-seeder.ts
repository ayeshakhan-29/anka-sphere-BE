import { FastifyInstance } from 'fastify';

const DESIGN_TASKS = [
  { title: 'Wireframes', description: 'Create low-fidelity wireframes for all key pages', sortOrder: 0 },
  { title: 'UI Design — Desktop', description: 'High-fidelity desktop designs in Figma', sortOrder: 1 },
  { title: 'UI Design — Mobile', description: 'Responsive mobile designs for all key screens', sortOrder: 2 },
  { title: 'Style Guide & Design System', description: 'Document colours, typography, components and spacing tokens', sortOrder: 3 },
  { title: 'Client Review & Revisions', description: 'Present designs to client and incorporate feedback rounds', sortOrder: 4 },
  { title: 'Design Handover', description: 'Export assets and prepare specs for development handover', sortOrder: 5 },
] as const;

const DEV_TASKS = [
  { title: 'Environment Setup', description: 'Configure dev, staging and production environments', sortOrder: 0 },
  { title: 'Database Schema', description: 'Implement and migrate the production database schema', sortOrder: 1 },
  { title: 'Backend API Development', description: 'Build all required API endpoints', sortOrder: 2 },
  { title: 'Frontend Development', description: 'Implement UI from approved designs', sortOrder: 3 },
  { title: 'Integration & Unit Tests', description: 'Write and run test suites for all critical paths', sortOrder: 4 },
  { title: 'Client UAT', description: 'Walk client through the build and collect sign-off', sortOrder: 5 },
  { title: 'Production Deployment', description: 'Deploy to production and verify all systems are live', sortOrder: 6 },
] as const;

const MARKETING_TASKS = [
  { title: 'Social Media Strategy', category: 'SOCIAL', description: 'Define platforms, tone of voice and posting schedule', sortOrder: 0 },
  { title: 'Content Calendar', category: 'CONTENT', description: 'Plan 30-day content calendar across all channels', sortOrder: 1 },
  { title: 'Paid Ads Campaign Setup', category: 'PAID', description: 'Set up and launch initial paid advertising campaigns', sortOrder: 2 },
  { title: 'SEO Optimisation', category: 'SEO', description: 'On-page SEO, meta tags, schema markup and sitemap submission', sortOrder: 3 },
  { title: 'Analytics & Tracking', category: 'ANALYTICS', description: 'Configure GA4, GTM and conversion tracking', sortOrder: 4 },
  { title: 'Launch Campaign', category: 'SOCIAL', description: 'Execute coordinated launch campaign across all channels', sortOrder: 5 },
] as const;

/**
 * Upsert the Design record for the project and seed default tasks if none exist.
 * Fire-and-forget — gate approval never fails because of this.
 */
export function seedDesignTasks(app: FastifyInstance, projectId: string): void {
  void (async () => {
    const design = await app.prisma.design.upsert({
      where: { projectId },
      update: {},
      create: { projectId },
      select: { id: true, tasks: { select: { id: true } } },
    });

    if (design.tasks.length > 0) return;

    await app.prisma.designTask.createMany({
      data: DESIGN_TASKS.map(t => ({
        designId: design.id,
        title: t.title,
        description: t.description,
        sortOrder: t.sortOrder,
        status: 'TODO' as const,
        priority: 'MEDIUM' as const,
      })),
    });

    app.log.info({ projectId, count: DESIGN_TASKS.length }, 'Seeded default design tasks');
  })().catch(err => app.log.error({ err, projectId }, 'Failed to seed design tasks'));
}

/**
 * Upsert the Development record and seed default tasks if none exist.
 */
export function seedDevTasks(app: FastifyInstance, projectId: string): void {
  void (async () => {
    const dev = await app.prisma.development.upsert({
      where: { projectId },
      update: {},
      create: { projectId },
      select: { id: true, tasks: { select: { id: true } } },
    });

    if (dev.tasks.length > 0) return;

    await app.prisma.devTask.createMany({
      data: DEV_TASKS.map(t => ({
        developmentId: dev.id,
        title: t.title,
        description: t.description,
        sortOrder: t.sortOrder,
        status: 'SETUP' as const,
        priority: 'MEDIUM' as const,
      })),
    });

    app.log.info({ projectId, count: DEV_TASKS.length }, 'Seeded default dev tasks');
  })().catch(err => app.log.error({ err, projectId }, 'Failed to seed dev tasks'));
}

/**
 * Upsert the Marketing record and seed default tasks if none exist.
 */
export function seedMarketingTasks(app: FastifyInstance, projectId: string): void {
  void (async () => {
    const marketing = await app.prisma.marketing.upsert({
      where: { projectId },
      update: {},
      create: { projectId },
      select: { id: true, tasks: { select: { id: true } } },
    });

    if (marketing.tasks.length > 0) return;

    await app.prisma.marketingTask.createMany({
      data: MARKETING_TASKS.map(t => ({
        marketingId: marketing.id,
        title: t.title,
        description: t.description,
        category: t.category,
        sortOrder: t.sortOrder,
        status: 'TODO' as const,
        priority: 'MEDIUM' as const,
      })),
    });

    app.log.info({ projectId, count: MARKETING_TASKS.length }, 'Seeded default marketing tasks');
  })().catch(err => app.log.error({ err, projectId }, 'Failed to seed marketing tasks'));
}
