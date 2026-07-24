import { FastifyPluginAsync } from 'fastify';
import { IntegrationProvider, IntegrationStatus } from '@prisma/client';
import { disconnectProviderSchema, oauthCallbackQuerySchema } from '../schemas/integrations.js';
import { verifyOAuthState, OAuthProviderSlug } from '../services/integrations/oauth.js';
import {
  GOOGLE_PROVIDERS,
  isGoogleConfigured,
  buildGoogleAuthUrl,
  handleGoogleCallback,
} from '../services/integrations/google-oauth.js';
import { isMetaConfigured, buildMetaAuthUrl, handleMetaCallback } from '../services/integrations/meta.js';
import { isTiktokConfigured, buildTiktokAuthUrl, handleTiktokCallback } from '../services/integrations/tiktok.js';
import { isS3Configured } from '../services/s3.js';

/** How each provider authenticates: OAuth flow vs. server-side env key. */
const PROVIDER_KIND: Record<IntegrationProvider, 'oauth' | 'env'> = {
  GOOGLE_ANALYTICS: 'oauth',
  GOOGLE_SEARCH_CONSOLE: 'oauth',
  GOOGLE_ADS: 'oauth',
  META: 'oauth',
  TIKTOK: 'oauth',
  STABILITY: 'env',
  RUNWAY: 'env',
};

interface IntegrationInfo {
  provider: IntegrationProvider | 'OPENAI';
  kind: 'oauth' | 'env';
  status: IntegrationStatus;
  configured: boolean; // env keys / OAuth app credentials present on the server
  accountName: string | null;
  connectedAt: Date | null;
  lastSyncedAt: Date | null;
  errorMessage: string | null;
}

const integrationRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // Where the browser lands after an OAuth round-trip (settings → integrations tab)
  const settingsUrl = (result: string, projectId?: string) => {
    if (projectId) {
      return `${process.env.FRONTEND_URL ?? 'http://localhost:4200'}/app/projects/${projectId}/analytics?integration=${result}`;
    }
    return `${process.env.FRONTEND_URL ?? 'http://localhost:4200'}/app/settings?integration=${result}`;
  };

  // ── Status of all integrations ──────────────────────────────────────────────

  app.get<{ Querystring: { projectId?: string } }>('/', auth, async (request) => {
    const { projectId } = request.query;
    const connections = await app.prisma.integrationConnection.findMany({
      where: {
        OR: [
          { projectId: projectId || null },
          { projectId: null }
        ]
      }
    });
    const byProvider = new Map<IntegrationProvider, any>();
    for (const c of connections) {
      const existing = byProvider.get(c.provider);
      if (!existing || (c.projectId && !existing.projectId)) {
        byProvider.set(c.provider, c);
      }
    }

    const oauthConfigured: Record<IntegrationProvider, boolean> = {
      GOOGLE_ANALYTICS: isGoogleConfigured(),
      GOOGLE_SEARCH_CONSOLE: isGoogleConfigured(),
      GOOGLE_ADS: isGoogleConfigured() && Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
      META: isMetaConfigured(),
      TIKTOK: isTiktokConfigured(),
      STABILITY: Boolean(process.env.STABILITY_API_KEY),
      RUNWAY: Boolean(process.env.RUNWAY_API_KEY),
    };

    const integrations: IntegrationInfo[] = (Object.keys(PROVIDER_KIND) as IntegrationProvider[]).map(
      (provider) => {
        const conn = byProvider.get(provider);
        const configured = oauthConfigured[provider];

        // Env-keyed providers are CONNECTED purely by key presence — no OAuth row
        const status: IntegrationStatus =
          PROVIDER_KIND[provider] === 'env'
            ? configured ? 'CONNECTED' : 'NOT_CONFIGURED'
            : conn?.status ?? 'NOT_CONFIGURED';

        return {
          provider,
          kind: PROVIDER_KIND[provider],
          status,
          configured,
          accountName: conn?.accountName ?? null,
          connectedAt: conn?.connectedAt ?? null,
          lastSyncedAt: conn?.lastSyncedAt ?? null,
          errorMessage: conn?.errorMessage ?? null,
        };
      },
    );

    // OpenAI is env-keyed like Stability/Runway; surfaced here so the settings
    // hub and the design tab's provider picker have one source of truth.
    integrations.push({
      provider: 'OPENAI',
      kind: 'env',
      status: process.env.OPENAI_API_KEY ? 'CONNECTED' : 'NOT_CONFIGURED',
      configured: Boolean(process.env.OPENAI_API_KEY),
      accountName: null,
      connectedAt: null,
      lastSyncedAt: null,
      errorMessage: null,
    });

    // AWS S3 is env-keyed for image/video storage.
    integrations.push({
      provider: 'AWS_S3' as any,
      kind: 'env',
      status: isS3Configured() ? 'CONNECTED' : 'NOT_CONFIGURED',
      configured: isS3Configured(),
      accountName: null,
      connectedAt: null,
      lastSyncedAt: null,
      errorMessage: null,
    });

    return { integrations };
  });

  // ── OAuth flows (google / meta / tiktok) ────────────────────────────────────

  async function resolveAuthUrl(slug: OAuthProviderSlug, projectId?: string): Promise<string> {
    if (slug === 'google') return buildGoogleAuthUrl(projectId);
    if (slug === 'meta') return buildMetaAuthUrl(app, projectId);
    return buildTiktokAuthUrl(app, projectId);
  }

  const callbackHandlers: Record<OAuthProviderSlug, (code: string, projectId?: string) => Promise<void>> = {
    google: (code, projectId) => handleGoogleCallback(app, code),
    meta: (code, projectId) => handleMetaCallback(app, code, projectId),
    tiktok: (code, projectId) => handleTiktokCallback(app, code, projectId),
  };

  for (const slug of ['google', 'meta', 'tiktok'] as const) {
    app.get<{ Querystring: { projectId?: string } }>(`/${slug}/auth-url`, auth, async (request) => {
      const { projectId } = request.query;
      return { url: await resolveAuthUrl(slug, projectId) };
    });

    // Callbacks come from the provider's redirect, so no JWT — the signed
    // short-lived `state` param proves the flow originated here.
    app.get(`/${slug}/callback`, async (request, reply) => {
      const query = oauthCallbackQuerySchema.parse(request.query);

      const verification = verifyOAuthState(query.state, slug);
      if (!verification.valid) {
        return reply.code(400).send({ error: 'Invalid or expired OAuth state.' });
      }
      if (query.error || !query.code) {
        app.log.warn({ provider: slug, error: query.error, description: query.error_description }, 'OAuth denied');
        return reply.redirect(settingsUrl(`${slug}_denied`, verification.projectId));
      }

      try {
        await callbackHandlers[slug](query.code, verification.projectId);
      } catch (err) {
        app.log.error({ err, provider: slug }, 'OAuth callback failed');
        return reply.redirect(settingsUrl(`${slug}_error`, verification.projectId));
      }
      return reply.redirect(settingsUrl(`${slug}_connected`, verification.projectId));
    });
  }

  // ── Disconnect ──────────────────────────────────────────────────────────────

  app.post<{ Params: { provider: string }; Querystring: { projectId?: string } }>('/:provider/disconnect', auth, async (request) => {
    const slug = disconnectProviderSchema.parse(request.params.provider);
    const { projectId } = request.query;

    // One Google sign-in backs three provider rows — they disconnect together
    const providers: IntegrationProvider[] =
      slug === 'google' ? GOOGLE_PROVIDERS : slug === 'meta' ? ['META'] : ['TIKTOK'];

    await app.prisma.integrationConnection.updateMany({
      where: {
        provider: { in: providers },
        projectId: projectId || null,
      },
      data: {
        status: 'NOT_CONFIGURED',
        accessTokenEnc: null,
        refreshTokenEnc: null,
        tokenExpiresAt: null,
        accountId: null,
        accountName: null,
        scopes: null,
        errorMessage: null,
        connectedAt: null,
      },
    });

    return { disconnected: providers };
  });
};

export default integrationRoutes;
