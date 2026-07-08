import { FastifyPluginAsync } from 'fastify';
import {
  upsertReportSchema,
  sendReportSchema,
  UpsertReportBody,
  SendReportBody,
} from '../schemas/report.js';

function senderAddress(name: string, email: string): string {
  const safeName = name.replace(/[\r\n"]/g, ' ').trim();
  return `"${safeName}" <${email}>`;
}

const reportRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // GET /projects/:id/reports
  app.get<{ Params: { id: string } }>('/:id/reports', auth, async (request) => {
    return app.prisma.report.findMany({
      where: { projectId: request.params.id },
      orderBy: { periodStart: 'desc' },
    });
  });

  // PUT /projects/:id/reports  (upsert draft for a period)
  app.put<{ Params: { id: string }; Body: UpsertReportBody }>(
    '/:id/reports',
    auth,
    async (request) => {
      const body = upsertReportSchema.parse(request.body);
      const periodStart = new Date(body.periodStart);
      const data = {
        period:     body.period,
        status:     body.status ?? 'DRAFT',
        summary:    body.summary,
        blockers:   body.blockers,
        highlights: body.highlights,
        nextSteps:  body.nextSteps,
      } as const;
      return app.prisma.report.upsert({
        where: {
          projectId_type_periodStart: {
            projectId: request.params.id,
            type: body.type,
            periodStart,
          },
        },
        update: data,
        create: {
          ...data,
          projectId: request.params.id,
          type: body.type,
          periodStart,
        },
      });
    },
  );

  // POST /projects/:id/reports/:reportId/send  (email the report)
  app.post<{ Params: { id: string; reportId: string }; Body: SendReportBody }>(
    '/:id/reports/:reportId/send',
    auth,
    async (request, reply) => {
      const { to } = sendReportSchema.parse(request.body);
      const report = await app.prisma.report.findUnique({
        where: { id: request.params.reportId },
        include: {
          project: {
            select: {
              name: true,
              clientName: true,
              emailSettings: { select: { fromName: true, fromEmail: true, replyToEmail: true, status: true } },
            },
          },
        },
      });
      if (!report || report.projectId !== request.params.id) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const sender = await app.prisma.user.findUnique({
        where: { id: request.user.sub },
        select: { name: true },
      });

      const typeLabel = report.type === 'WEEKLY' ? 'Weekly' : 'Monthly';
      const emailSettings = report.project.emailSettings?.status === 'ACTIVE' ? report.project.emailSettings : null;
      const section = (label: string, value: string | null) =>
        value ? `<p style="margin:14px 0 4px"><strong>${label}</strong></p><p style="margin:0">${value.replace(/\n/g, '<br>')}</p>` : '';

      const result = await app.mailer.send({
        to,
        from: emailSettings ? senderAddress(emailSettings.fromName, emailSettings.fromEmail) : undefined,
        replyTo: emailSettings?.replyToEmail ?? undefined,
        brandName: emailSettings?.fromName ?? report.project.name,
        subject: `${typeLabel} report — ${report.project.name} (${report.period})`,
        heading: `${typeLabel} report · ${report.project.name}`,
        bodyHtml:
          `<p style="margin:0">Client: <strong>${report.project.clientName}</strong> · Period: <strong>${report.period}</strong></p>` +
          section('Summary', report.summary) +
          section('Highlights', report.highlights) +
          section('Blockers', report.blockers) +
          section('Next steps', report.nextSteps),
        ctaLabel: 'View in Anka Sphere',
        ctaUrl: `${process.env.FRONTEND_URL ?? 'http://localhost:4200'}/app/projects/${report.projectId}/reporting`,
      });

      const updated = await app.prisma.report.update({
        where: { id: report.id },
        data: {
          status: 'SENT',
          sentTo: to.join(', '),
          sentAt: new Date(),
          sentByName: sender?.name ?? 'Unknown',
        },
      });

      return { report: updated, previewUrl: result.previewUrl };
    },
  );
};

export default reportRoutes;
