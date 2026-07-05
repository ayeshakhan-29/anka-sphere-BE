import { FastifyInstance } from 'fastify';

type Stage = 'PROFILING' | 'WRITTEN_CONTENT' | 'DESIGN' | 'DEVELOPMENT' | 'MARKETING';

const STAGE_LABEL: Record<Stage, string> = {
  PROFILING: 'Project Profiling',
  WRITTEN_CONTENT: 'Written Content',
  DESIGN: 'Design',
  DEVELOPMENT: 'Development',
  MARKETING: 'Marketing',
};

// Who picks up the work when a stage unlocks
const STAGE_ROLES: Record<Stage, string[]> = {
  PROFILING: ['MANAGER_PRODUCT_MODELLING'],
  WRITTEN_CONTENT: ['CONTENT_WRITER', 'MANAGER_PRODUCT_MODELLING'],
  DESIGN: ['DESIGNER', 'MANAGER_PRODUCT_MODELLING'],
  DEVELOPMENT: ['DEVELOPER', 'MANAGER_PRODUCT_DEVELOPMENT'],
  MARKETING: ['SOCIAL_MEDIA', 'PAID_ADS', 'SEO', 'MANAGER_PRODUCT_GROWTH'],
};

const frontendUrl = () => process.env.FRONTEND_URL ?? 'http://localhost:4200';

/**
 * Email the team that picks up the next stage after a gate is approved.
 * Fire-and-forget: never throws, so gate approval never fails because of email.
 */
export function notifyGateHandoff(
  app: FastifyInstance,
  projectId: string,
  approvedStage: Stage,
  nextStage: Stage | null,
): void {
  void (async () => {
    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, clientName: true },
    });
    if (!project) return;

    const roles = nextStage ? STAGE_ROLES[nextStage] : ['ADMIN', 'MANAGER_PRODUCT_GROWTH'];
    const recipients = await app.prisma.user.findMany({
      where: { role: { in: roles as never[] } },
      select: { email: true },
    });
    if (recipients.length === 0) return;

    const subject = nextStage
      ? `${project.name} — ${STAGE_LABEL[nextStage]} stage unlocked`
      : `${project.name} — all pipeline stages complete`;
    const heading = nextStage
      ? `${STAGE_LABEL[nextStage]} is ready to start`
      : 'Project pipeline complete 🎉';
    const bodyHtml = nextStage
      ? `The <strong>${STAGE_LABEL[approvedStage]}</strong> gate for
         <strong>${project.name}</strong> (${project.clientName}) has been approved.
         The <strong>${STAGE_LABEL[nextStage]}</strong> stage is now unlocked and assigned to your team.`
      : `The <strong>${STAGE_LABEL[approvedStage]}</strong> stage for
         <strong>${project.name}</strong> (${project.clientName}) has been completed.
         All five pipeline stages are now done.`;

    await app.mailer.send({
      to: recipients.map((r) => r.email),
      subject,
      heading,
      bodyHtml,
      ctaLabel: 'Open project',
      ctaUrl: `${frontendUrl()}/app/projects/${projectId}`,
    });
  })().catch((err) => app.log.error({ err, projectId, approvedStage }, 'Gate handoff email failed'));
}
