import { FastifyInstance } from 'fastify';
import { IntegrationProvider } from '@prisma/client';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { createOAuthState, redirectUriFor } from './oauth.js';
import { IntegrationUnavailableError, IntegrationRequestError } from './errors.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// One Google connection covers GA4, Search Console, and Google Ads.
const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

/**
 * The schema keys connections by IntegrationProvider, which has no generic
 * GOOGLE value — a single Google sign-in covers all three rows below. They are
 * written, refreshed, and disconnected together; GOOGLE_ANALYTICS is the
 * canonical row reads go through.
 */
export const GOOGLE_PROVIDERS: IntegrationProvider[] = [
  'GOOGLE_ANALYTICS',
  'GOOGLE_SEARCH_CONSOLE',
  'GOOGLE_ADS',
];
const CANONICAL: IntegrationProvider = 'GOOGLE_ANALYTICS';

export function isGoogleConfigured(): boolean {
  if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) return true;
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function requireEnv(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new IntegrationUnavailableError('Google OAuth is not configured (missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).');
  }
  return { clientId, clientSecret };
}

export function buildGoogleAuthUrl(): string {
  const state = createOAuthState('google');
  if (!isGoogleConfigured()) {
    return `/integrations/google/callback?code=mock-code&state=${state}`;
  }
  const { clientId } = requireEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUriFor('google'),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline', // ask for a refresh token
    prompt: 'consent',      // force refresh_token even on re-consent
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    throw new IntegrationRequestError('Could not reach Google.');
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error_description?: string; error?: string } | null;
    throw new IntegrationRequestError(detail?.error_description ?? detail?.error ?? 'Google token request failed.');
  }
  return (await res.json()) as TokenResponse;
}

/** Exchange the OAuth code and persist encrypted tokens on all Google provider rows. */
export async function handleGoogleCallback(app: FastifyInstance, code: string): Promise<void> {
  if (code === 'mock-code') {
    const data = {
      status: 'CONNECTED' as const,
      accessTokenEnc: encrypt('mock-access-token'),
      refreshTokenEnc: encrypt('mock-refresh-token'),
      tokenExpiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000), // 1 year
      accountId: 'mock-google-id',
      accountName: 'mock.user@google.com',
      scopes: SCOPES,
      errorMessage: null,
      connectedAt: new Date(),
    };

    await app.prisma.$transaction(
      GOOGLE_PROVIDERS.map((provider) =>
        app.prisma.integrationConnection.upsert({
          where: { provider },
          update: data,
          create: { provider, ...data },
        }),
      ),
    );
    return;
  }

  const { clientId, clientSecret } = requireEnv();

  const tokens = await postToken(new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUriFor('google'),
    grant_type: 'authorization_code',
  }));

  // Best-effort account label for the settings UI
  let accountName: string | null = null;
  let accountId: string | null = null;
  try {
    const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (res.ok) {
      const info = (await res.json()) as { id?: string; email?: string };
      accountId = info.id ?? null;
      accountName = info.email ?? null;
    }
  } catch (err) {
    app.log.warn({ err }, 'Could not fetch Google account info');
  }

  const data = {
    status: 'CONNECTED' as const,
    accessTokenEnc: encrypt(tokens.access_token),
    refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    accountId,
    accountName,
    scopes: tokens.scope ?? SCOPES,
    errorMessage: null,
    connectedAt: new Date(),
  };

  await app.prisma.$transaction(
    GOOGLE_PROVIDERS.map((provider) =>
      app.prisma.integrationConnection.upsert({
        where: { provider },
        update: data,
        create: { provider, ...data },
      }),
    ),
  );
}

/**
 * Return a valid Google access token, refreshing (and re-persisting) it when
 * within a minute of expiry. Used by the GA4/GSC/Ads services in later tasks.
 */
export async function getGoogleAccessToken(app: FastifyInstance): Promise<string> {
  const conn = await app.prisma.integrationConnection.findUnique({ where: { provider: CANONICAL } });
  if (!conn || conn.status !== 'CONNECTED' || !conn.accessTokenEnc) {
    throw new IntegrationUnavailableError('Google is not connected.');
  }

  if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() > Date.now() + 60_000) {
    return decrypt(conn.accessTokenEnc);
  }

  if (!conn.refreshTokenEnc) {
    throw new IntegrationUnavailableError('Google token expired and no refresh token is stored — reconnect Google.');
  }

  const { clientId, clientSecret } = requireEnv();
  let tokens: TokenResponse;
  try {
    tokens = await postToken(new URLSearchParams({
      refresh_token: decrypt(conn.refreshTokenEnc),
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Google token refresh failed.';
    await app.prisma.integrationConnection.updateMany({
      where: { provider: { in: GOOGLE_PROVIDERS } },
      data: { status: 'ERROR', errorMessage: message },
    });
    throw err;
  }

  const accessTokenEnc = encrypt(tokens.access_token);
  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await app.prisma.integrationConnection.updateMany({
    where: { provider: { in: GOOGLE_PROVIDERS } },
    data: { accessTokenEnc, tokenExpiresAt, status: 'CONNECTED', errorMessage: null },
  });

  return tokens.access_token;
}
