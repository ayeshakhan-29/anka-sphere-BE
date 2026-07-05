import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { chatJSON } from './openai.js';

function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day; // back to Monday
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function weekLabel(monday: Date): string {
  const end = new Date(monday);
  end.setDate(end.getDate() + 6);
  const fmt = (x: Date) => x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${fmt(monday)} – ${fmt(end)} ${end.getFullYear()}`;
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

async function projectStats(app: FastifyInstance, projectId: string) {
  const project = await app.prisma.project.findUnique({
    where: { id: projectId },
    include: {
      pipeline: true,
      milestones: true,
      design: { include: { tasks: true } },
      development: { include: { tasks: true } },
      marketing: { include: { tasks: true } },
    },
  });
  if (!project) return null;
  const tasks = [
    ...(project.design?.tasks ?? []),
    ...(project.development?.tasks ?? []),
    ...(project.marketing?.tasks ?? []),
  ];
  const done = tasks.filter((t) => String(t.status) === 'DONE' || String(t.status) === 'LIVE').length;
  const approvedStages = project.pipeline.filter((p) => p.status === 'APPROVED').length;
  const msDone = project.milestones.filter((m) => m.status === 'DONE').length;
  return { project, tasks: tasks.length, done, approvedStages, msDone, msTotal: project.milestones.length };
}

async function generateDrafts(app: FastifyInstance, type: 'WEEKLY' | 'MONTHLY'): Promise<number> {
  const now = new Date();
  const periodStart = type === 'WEEKLY' ? startOfWeek(now) : new Date(now.getFullYear(), now.getMonth(), 1);
  const period = type === 'WEEKLY' ? weekLabel(periodStart) : monthLabel(periodStart);

  const projects = await app.prisma.project.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  let created = 0;
  for (const { id } of projects) {
    const existing = await app.prisma.report.findUnique({
      where: { projectId_type_periodStart: { projectId: id, type, periodStart } },
    });
    if (existing) continue;

    const stats = await projectStats(app, id);
    if (!stats) continue;

    // Template fallback — always available
    let summary =
      type === 'WEEKLY'
        ? `${stats.project.name} for ${stats.project.clientName} is in the ${stats.project.currentStage} stage. ` +
          `${stats.approvedStages} of 5 pipeline stages approved; ${stats.done} of ${stats.tasks} tasks done.`
        : `${stats.project.name} progressed through the ${stats.project.currentStage} stage this month. ` +
          `${stats.msDone} of ${stats.msTotal} milestones completed; ${stats.done} of ${stats.tasks} tasks done overall.`;
    let highlights: string | undefined;
    let nextSteps: string | undefined;

    // Upgrade to an LLM-written narrative when a key is configured
    if (process.env.OPENAI_API_KEY) {
      try {
        const draft = await chatJSON<{ summary: string; highlights: string; nextSteps: string }>(app, {
          operation: 'report.auto-draft',
          projectId: id,
          system:
            `You write concise client-facing agency status reports. Base every claim strictly on the facts given — ` +
            `never invent metrics, dates, or events. Plain professional English. ` +
            `Respond with a single JSON object: {"summary": string, "highlights": string, "nextSteps": string}. ` +
            `summary: 3-4 sentences of ${type === 'WEEKLY' ? 'weekly' : 'monthly'} progress. ` +
            `highlights and nextSteps: 2-3 plain-text bullet lines each, one per line.`,
          user:
            `Project: ${stats.project.name} for ${stats.project.clientName}\n` +
            `Current stage: ${stats.project.currentStage} (${stats.approvedStages}/5 stages approved)\n` +
            `Tasks done: ${stats.done}/${stats.tasks}\n` +
            `Milestones done: ${stats.msDone}/${stats.msTotal}`,
        });
        if (draft.summary) summary = draft.summary;
        highlights = draft.highlights || undefined;
        nextSteps = draft.nextSteps || undefined;
      } catch (err) {
        app.log.warn({ err, projectId: id }, 'AI report narrative failed — using template summary');
      }
    }

    await app.prisma.report.create({
      data: { projectId: id, type, period, periodStart, summary, highlights, nextSteps, auto: true },
    });
    created++;
  }

  if (created > 0) {
    const managers = await app.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'MANAGER_PRODUCT_MODELLING', 'MANAGER_PRODUCT_DEVELOPMENT', 'MANAGER_PRODUCT_GROWTH'] as never[] } },
      select: { email: true },
    });
    if (managers.length > 0) {
      await app.mailer.send({
        to: managers.map((m) => m.email),
        subject: `${created} ${type.toLowerCase()} report draft(s) ready for review`,
        heading: `${type === 'WEEKLY' ? 'Weekly' : 'Monthly'} report drafts generated`,
        bodyHtml: `Draft ${type.toLowerCase()} reports for <strong>${period}</strong> have been auto-generated for ${created} active project(s). Review, edit, and send them from each project's Reporting tab.`,
        ctaLabel: 'Open Anka Sphere',
        ctaUrl: `${process.env.FRONTEND_URL ?? 'http://localhost:4200'}/app/reporting`,
      });
    }
  }
  return created;
}

/**
 * Weekly drafts every Monday 08:00, monthly drafts on the 1st 08:00.
 * Also runs a catch-up on boot so a server that was asleep over the
 * trigger time still produces the current period's drafts.
 */
export function startReportScheduler(app: FastifyInstance): void {
  if (process.env.DISABLE_REPORT_CRON === 'true') {
    app.log.info('Report scheduler disabled via DISABLE_REPORT_CRON');
    return;
  }

  cron.schedule('0 8 * * 1', () => {
    generateDrafts(app, 'WEEKLY')
      .then((n) => app.log.info({ created: n }, 'Weekly report drafts generated'))
      .catch((err) => app.log.error({ err }, 'Weekly report generation failed'));
  });

  cron.schedule('0 8 1 * *', () => {
    generateDrafts(app, 'MONTHLY')
      .then((n) => app.log.info({ created: n }, 'Monthly report drafts generated'))
      .catch((err) => app.log.error({ err }, 'Monthly report generation failed'));
  });

  // Catch-up on boot: create current-period drafts if missing
  void generateDrafts(app, 'WEEKLY')
    .then((n) => { if (n > 0) app.log.info({ created: n }, 'Catch-up weekly drafts generated'); })
    .catch((err) => app.log.error({ err }, 'Catch-up weekly draft generation failed'));
  void generateDrafts(app, 'MONTHLY')
    .then((n) => { if (n > 0) app.log.info({ created: n }, 'Catch-up monthly drafts generated'); })
    .catch((err) => app.log.error({ err }, 'Catch-up monthly draft generation failed'));

  app.log.info('Report scheduler started (weekly: Mon 08:00, monthly: 1st 08:00)');
}
