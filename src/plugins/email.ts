import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import nodemailer, { Transporter } from 'nodemailer';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  heading: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  from?: string;
  replyTo?: string;
  brandName?: string;
}

export interface Mailer {
  send(opts: SendEmailOptions): Promise<{ messageId: string; previewUrl?: string }>;
}

declare module 'fastify' {
  interface FastifyInstance {
    mailer: Mailer;
  }
}

const FROM = () => process.env.EMAIL_FROM ?? 'Anka Sphere <no-reply@anka.agency>';
const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] ?? ch));

function layout(opts: SendEmailOptions): string {
  const brand = escapeHtml(opts.brandName ?? 'Anka Sphere');
  const cta =
    opts.ctaLabel && opts.ctaUrl
      ? `<tr><td style="padding:24px 32px 0">
           <a href="${opts.ctaUrl}" style="display:inline-block;background:#0F172A;color:#F8FAFC;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:8px">${opts.ctaLabel}</a>
         </td></tr>`
      : '';
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;border:1px solid #E2E8F0;text-align:left">
        <tr><td style="padding:28px 32px 0">
          <span style="display:inline-block;background:#0F172A;color:#F8FAFC;font-size:12px;font-weight:700;letter-spacing:0.08em;padding:6px 12px;border-radius:6px">${brand.toUpperCase()}</span>
        </td></tr>
        <tr><td style="padding:24px 32px 0">
          <h1 style="margin:0;font-size:19px;font-weight:600;color:#0F172A">${opts.heading}</h1>
        </td></tr>
        <tr><td style="padding:14px 32px 0;font-size:14px;line-height:1.65;color:#334155">${opts.bodyHtml}</td></tr>
        ${cta}
        <tr><td style="padding:28px 32px 28px;font-size:12px;color:#94A3B8">
          You are receiving this because you are a member of the Anka Sphere workspace.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const emailPlugin: FastifyPluginAsync = fp(async (app) => {
  let transporterPromise: Promise<Transporter> | null = null;
  let usingEthereal = false;

  function getTransporter(): Promise<Transporter> {
    transporterPromise ??= (async () => {
      if (process.env.SMTP_HOST) {
        app.log.info({ host: process.env.SMTP_HOST }, 'Mailer: using configured SMTP');
        return nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT ?? 587),
          secure: process.env.SMTP_SECURE === 'true',
          auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
        });
      }
      // Dev fallback: Ethereal test inbox — mails are captured online, never delivered.
      const account = await nodemailer.createTestAccount();
      usingEthereal = true;
      app.log.warn(
        { user: account.user },
        'Mailer: no SMTP_HOST set — using Ethereal test inbox (preview URLs will be logged, nothing is delivered)',
      );
      return nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass },
      });
    })();
    return transporterPromise;
  }

  const mailer: Mailer = {
    async send(opts) {
      const t = await getTransporter();
      const info = await t.sendMail({
        from: opts.from ?? FROM(),
        replyTo: opts.replyTo,
        to: Array.isArray(opts.to) ? opts.to.join(', ') : opts.to,
        subject: opts.subject,
        html: layout(opts),
      });
      const previewUrl = usingEthereal
        ? (nodemailer.getTestMessageUrl(info) || undefined)
        : undefined;
      if (previewUrl) app.log.info({ previewUrl, subject: opts.subject }, 'Email captured (Ethereal preview)');
      else app.log.info({ to: opts.to, subject: opts.subject }, 'Email sent');
      return { messageId: info.messageId, previewUrl };
    },
  };

  app.decorate('mailer', mailer);
});

export default emailPlugin;
