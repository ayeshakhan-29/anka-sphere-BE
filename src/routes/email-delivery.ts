import { FastifyPluginAsync } from 'fastify';
import {
  markEmailDeliveryConfiguredSchema,
  upsertEmailDeliverySchema,
  MarkEmailDeliveryConfiguredBody,
  UpsertEmailDeliveryBody,
} from '../schemas/email-delivery.js';

type EmailProviderId = UpsertEmailDeliveryBody['provider'];

interface DnsRecord {
  type: 'TXT' | 'CNAME' | 'MX';
  host: string;
  value: string;
  priority?: number;
  purpose: 'SPF' | 'DKIM' | 'DMARC' | 'RETURN_PATH' | 'INBOUND';
  required: boolean;
}

function recordsFor(provider: EmailProviderId, domain: string): DnsRecord[] {
  const dmarc: DnsRecord = {
    type: 'TXT',
    host: '_dmarc',
    value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
    purpose: 'DMARC',
    required: false,
  };

  if (provider === 'POSTMARK') {
    return [
      { type: 'TXT', host: '@', value: 'v=spf1 include:spf.mtasv.net ~all', purpose: 'SPF', required: true },
      { type: 'TXT', host: 'pm._domainkey', value: 'Copy the DKIM TXT value from Postmark for this domain', purpose: 'DKIM', required: true },
      { type: 'CNAME', host: 'pm-bounces', value: 'pm.mtasv.net', purpose: 'RETURN_PATH', required: false },
      dmarc,
    ];
  }

  if (provider === 'SENDGRID') {
    return [
      { type: 'CNAME', host: 'em', value: 'u000000.wl000.sendgrid.net', purpose: 'SPF', required: true },
      { type: 'CNAME', host: 's1._domainkey', value: 's1.domainkey.u000000.wl000.sendgrid.net', purpose: 'DKIM', required: true },
      { type: 'CNAME', host: 's2._domainkey', value: 's2.domainkey.u000000.wl000.sendgrid.net', purpose: 'DKIM', required: true },
      dmarc,
    ];
  }

  if (provider === 'MAILGUN') {
    return [
      { type: 'TXT', host: '@', value: 'v=spf1 include:mailgun.org ~all', purpose: 'SPF', required: true },
      { type: 'TXT', host: 'k1._domainkey', value: 'Copy the DKIM TXT value from Mailgun for this domain', purpose: 'DKIM', required: true },
      { type: 'MX', host: '@', value: 'mxa.mailgun.org', priority: 10, purpose: 'INBOUND', required: false },
      { type: 'MX', host: '@', value: 'mxb.mailgun.org', priority: 10, purpose: 'INBOUND', required: false },
      dmarc,
    ];
  }

  if (provider === 'CUSTOM_SMTP') {
    return [
      { type: 'TXT', host: '@', value: 'v=spf1 include:_spf.your-mail-provider.example ~all', purpose: 'SPF', required: true },
      { type: 'TXT', host: 'default._domainkey', value: 'Copy the DKIM TXT value from your SMTP/mail provider', purpose: 'DKIM', required: true },
      dmarc,
    ];
  }

  return [
    { type: 'TXT', host: '@', value: 'v=spf1 include:amazonses.com ~all', purpose: 'SPF', required: true },
    { type: 'CNAME', host: 'resend._domainkey', value: 'resend._domainkey.resend.com', purpose: 'DKIM', required: true },
    dmarc,
  ];
}

function response(settings: {
  id: string;
  projectId: string;
  provider: EmailProviderId;
  domain: string;
  fromName: string;
  fromEmail: string;
  replyToEmail: string | null;
  status: 'PENDING_DNS' | 'ACTIVE';
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
} | null) {
  return {
    settings,
    dnsRecords: settings ? recordsFor(settings.provider, settings.domain) : [],
    estimatedSetupMinutes: 10,
    activeFrom: settings?.status === 'ACTIVE' ? settings.fromEmail : null,
  };
}

const emailDeliveryRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  app.get<{ Params: { id: string } }>('/:id/email-delivery', auth, async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const settings = await app.prisma.projectEmailSettings.findUnique({ where: { projectId: request.params.id } });
    return response(settings);
  });

  app.put<{ Params: { id: string }; Body: UpsertEmailDeliveryBody }>(
    '/:id/email-delivery',
    auth,
    async (request, reply) => {
      const project = await app.prisma.project.findUnique({ where: { id: request.params.id }, select: { id: true } });
      if (!project) return reply.code(404).send({ error: 'Project not found' });

      const body = upsertEmailDeliverySchema.parse(request.body);
      const fromEmail = `${body.fromLocalPart}@${body.domain}`;
      const settings = await app.prisma.projectEmailSettings.upsert({
        where: { projectId: request.params.id },
        update: {
          provider: body.provider,
          domain: body.domain,
          fromName: body.fromName,
          fromEmail,
          replyToEmail: body.replyToEmail,
          status: 'PENDING_DNS',
          verifiedAt: null,
        },
        create: {
          projectId: request.params.id,
          provider: body.provider,
          domain: body.domain,
          fromName: body.fromName,
          fromEmail,
          replyToEmail: body.replyToEmail,
        },
      });

      return response(settings);
    },
  );

  app.post<{ Params: { id: string }; Body: MarkEmailDeliveryConfiguredBody }>(
    '/:id/email-delivery/mark-configured',
    auth,
    async (request, reply) => {
      markEmailDeliveryConfiguredSchema.parse(request.body);
      const existing = await app.prisma.projectEmailSettings.findUnique({ where: { projectId: request.params.id } });
      if (!existing) return reply.code(404).send({ error: 'Email delivery settings not found' });

      const settings = await app.prisma.projectEmailSettings.update({
        where: { projectId: request.params.id },
        data: { status: 'ACTIVE', verifiedAt: new Date() },
      });

      return response(settings);
    },
  );
};

export default emailDeliveryRoutes;