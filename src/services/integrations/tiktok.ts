import { FastifyInstance } from 'fastify';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { createOAuthState, redirectUriFor } from './oauth.js';
import { IntegrationUnavailableError, IntegrationRequestError } from './errors.js';

const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';

// Content Posting API (Task 8) + basic profile for the settings UI
const SCOPES = ['user.info.basic', 'video.publish', 'video.upload'].join(',');

export function isTiktokConfigured(): boolean {
  if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) return true;
  return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
}

function requireEnv(): { clientKey: string; clientSecret: string } {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new IntegrationUnavailableError('TikTok OAuth is not configured (missing TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET).');
  }
  return { clientKey, clientSecret };
}

export function buildTiktokAuthUrl(): string {
  const state = createOAuthState('tiktok');
  if (!isTiktokConfigured()) {
    return `/integrations/tiktok/callback?code=mock-code&state=${state}`;
  }
  const { clientKey } = requireEnv();
  const params = new URLSearchParams({
    client_key: clientKey,
    redirect_uri: redirectUriFor('tiktok'),
    response_type: 'code',
    scope: SCOPES,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
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
    throw new IntegrationRequestError('Could not reach TikTok.');
  }
  const json = (await res.json().catch(() => null)) as TokenResponse | null;
  if (!res.ok || !json || json.error || !json.access_token) {
    throw new IntegrationRequestError(json?.error_description ?? json?.error ?? 'TikTok token request failed.');
  }
  return json;
}

/** Exchange the OAuth code and persist encrypted tokens. */
export async function handleTiktokCallback(app: FastifyInstance, code: string): Promise<void> {
  if (code === 'mock-code') {
    const data = {
      status: 'CONNECTED' as const,
      accessTokenEnc: encrypt('mock-access-token'),
      refreshTokenEnc: encrypt('mock-refresh-token'),
      tokenExpiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000), // 1 year
      accountId: 'mock-tiktok-id',
      accountName: 'Mock TikTok Account',
      scopes: SCOPES,
      errorMessage: null,
      connectedAt: new Date(),
    };
    await app.prisma.integrationConnection.upsert({
      where: { provider: 'TIKTOK' },
      update: data,
      create: { provider: 'TIKTOK', ...data },
    });
    return;
  }

  const { clientKey, clientSecret } = requireEnv();

  const tokens = await postToken(new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUriFor('tiktok'),
  }));

  const data = {
    status: 'CONNECTED' as const,
    accessTokenEnc: encrypt(tokens.access_token),
    refreshTokenEnc: encrypt(tokens.refresh_token),
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    accountId: tokens.open_id ?? null,
    accountName: null,
    scopes: tokens.scope ?? SCOPES,
    errorMessage: null,
    connectedAt: new Date(),
  };

  await app.prisma.integrationConnection.upsert({
    where: { provider: 'TIKTOK' },
    update: data,
    create: { provider: 'TIKTOK', ...data },
  });
}

/** Return a valid TikTok access token, refreshing it when near expiry. */
export async function getTiktokAccessToken(app: FastifyInstance): Promise<string> {
  const conn = await app.prisma.integrationConnection.findUnique({ where: { provider: 'TIKTOK' } });
  if (!conn || conn.status !== 'CONNECTED' || !conn.accessTokenEnc) {
    throw new IntegrationUnavailableError('TikTok is not connected.');
  }

  if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() > Date.now() + 60_000) {
    return decrypt(conn.accessTokenEnc);
  }

  if (!conn.refreshTokenEnc) {
    throw new IntegrationUnavailableError('TikTok token expired and no refresh token is stored — reconnect TikTok.');
  }

  const { clientKey, clientSecret } = requireEnv();
  let tokens: TokenResponse;
  try {
    tokens = await postToken(new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: decrypt(conn.refreshTokenEnc),
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'TikTok token refresh failed.';
    await app.prisma.integrationConnection.update({
      where: { provider: 'TIKTOK' },
      data: { status: 'ERROR', errorMessage: message },
    });
    throw err;
  }

  await app.prisma.integrationConnection.update({
    where: { provider: 'TIKTOK' },
    data: {
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: encrypt(tokens.refresh_token),
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      status: 'CONNECTED',
      errorMessage: null,
    },
  });

  return tokens.access_token;
}

// ── Content Posting API (Task 8) ────────────────────────────────────────────

const OPEN_API = 'https://open.tiktokapis.com/v2';

/**
 * Publish a video by public URL via PULL_FROM_URL. TikTok ingests
 * asynchronously — we return the publish handle; failures surface on the
 * TikTok side (the user's inbox) rather than synchronously here.
 */
export async function publishToTiktok(
  app: FastifyInstance,
  title: string,
  videoUrl: string,
): Promise<{ externalPostId: string; externalUrl: string | null }> {
  const token = await getTiktokAccessToken(app);
  if (token === 'mock-access-token') {
    const publishId = `mock-tt-publish-${Math.random().toString(36).substring(2, 10)}`;
    return { externalPostId: publishId, externalUrl: `https://www.tiktok.com/` };
  }
  if (!/^https?:\/\//.test(videoUrl)) {
    throw new IntegrationRequestError('TikTok publishing needs a public video URL (base64 data URIs are not supported).', 422);
  }

  let res: Response;
  try {
    res = await fetch(`${OPEN_API}/post/publish/video/init/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post_info: { title, privacy_level: 'SELF_ONLY' }, // sandbox-safe default; users flip visibility in TikTok
        source_info: { source: 'PULL_FROM_URL', video_url: videoUrl },
      }),
    });
  } catch {
    throw new IntegrationRequestError('Could not reach TikTok.');
  }

  const json = (await res.json().catch(() => null)) as {
    data?: { publish_id?: string };
    error?: { code?: string; message?: string };
  } | null;

  if (!res.ok || !json?.data?.publish_id || (json.error && json.error.code !== 'ok')) {
    throw new IntegrationRequestError(json?.error?.message ?? 'TikTok publish request failed.');
  }
  return { externalPostId: json.data.publish_id, externalUrl: null };
}
