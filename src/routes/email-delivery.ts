import { promises as dns } from 'dns';
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

interface DnsCheckResult extends DnsRecord {
  verified: boolean;
  actual: string | null; // what the resolver returned, for troubleshooting
}

/**
 * Some generated records carry instructions instead of literal values (e.g.
 * provider-specific DKIM keys the user copies from their dashboard) — those
 * can only be checked for existence, not exact match.
 */
function isPlaceholderValue(value: string): boolean {
  return value.startsWith('Copy the') || value.includes('u000000') || value.includes('your-mail-provider');
}

async function checkDnsRecord(record: DnsRecord, domain: string): Promise<DnsCheckResult> {
  const fqdn = record.host === '@' ? domain : `${record.host}.${domain}`;
  const normalize = (v: string) => v.trim().toLowerCase().replace(/\.$/, '');

  try {
    if (record.type === 'TXT') {
      const txts = (await dns.resolveTxt(fqdn)).map((chunks) => chunks.join(''));
      const actual = txts.join(' | ') || null;

      let verified: boolean;
      if (isPlaceholderValue(record.value)) {
        verified = txts.length > 0;
      } else if (record.purpose === 'SPF') {
        // The user may have merged our include into an existing SPF record
        const include = record.value.match(/include:(\S+)/)?.[1];
        verified = txts.some((t) => t.startsWith('v=spf1') && (!include || t.includes(include)));
      } else if (record.purpose === 'DMARC') {
        verified = txts.some((t) => t.startsWith('v=DMARC1'));
      } else {
        verified = txts.some((t) => normalize(t) === normalize(record.value));
      }
      return { ...record, verified, actual };
    }

    if (record.type === 'CNAME') {
      const targets = await dns.resolveCname(fqdn);
      const actual = targets.join(' | ') || null;
      const verified = isPlaceholderValue(record.value)
        ? targets.length > 0
        : targets.some((t) => normalize(t) === normalize(record.value));
      return { ...record, verified, actual };
    }

    // MX
    const mx = await dns.resolveMx(fqdn);
    const actual = mx.map((m) => `${m.priority} ${m.exchange}`).join(' | ') || null;
    const verified = mx.some((m) => normalize(m.exchange) === normalize(record.value));
    return { ...record, verified, actual };
  } catch {
    // ENOTFOUND / ENODATA / SERVFAIL — the record simply isn't visible yet
    return { ...record, verified: false, actual: null };
  }
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

  app.post<{ Params: { id: string } }>('/:id/email-delivery/verify-dns', auth, async (request, reply) => {
    const existing = await app.prisma.projectEmailSettings.findUnique({ where: { projectId: request.params.id } });
    if (!existing) return reply.code(404).send({ error: 'Email delivery settings not found' });

    const records = recordsFor(existing.provider, existing.domain);
    const results = await Promise.all(records.map((record) => checkDnsRecord(record, existing.domain)));
    const allRequiredVerified = results.filter((r) => r.required).every((r) => r.verified);

    const settings = allRequiredVerified && existing.status !== 'ACTIVE'
      ? await app.prisma.projectEmailSettings.update({
          where: { projectId: request.params.id },
          data: { status: 'ACTIVE', verifiedAt: new Date() },
        })
      : existing;

    return { ...response(settings), dnsRecords: results, allRequiredVerified };
  });

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