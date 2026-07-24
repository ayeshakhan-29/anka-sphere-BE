import { FastifyInstance } from 'fastify';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { createOAuthState, redirectUriFor } from './oauth.js';
import { IntegrationUnavailableError, IntegrationRequestError } from './errors.js';

const AUTH_URL = 'https://www.facebook.com/v21.0/dialog/oauth';
const GRAPH = 'https://graph.facebook.com/v21.0';

// Standard Meta Graph API permissions compatible with Development & Business app modes
const SCOPES = [
  'public_profile',
  'pages_show_list',
  'pages_read_engagement',
  'ads_read',
  'business_management',
].join(',');


export function isMetaConfigured(): boolean {
  if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) return true;
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

/** Resolve Meta credentials: project DB creds first, then env vars. */
async function getProjectMetaEnv(
  app: FastifyInstance,
  projectId?: string,
): Promise<{ appId: string; appSecret: string } | null> {
  if (projectId) {
    const creds = await app.prisma.projectSocialCredentials.findUnique({ where: { projectId } });
    if (creds?.metaAppIdEnc && creds?.metaAppSecretEnc) {
      return { appId: decrypt(creds.metaAppIdEnc), appSecret: decrypt(creds.metaAppSecretEnc) };
    }
  }
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (appId && appSecret) return { appId, appSecret };
  return null;
}

export async function buildMetaAuthUrl(app: FastifyInstance, projectId?: string): Promise<string> {
  const state = createOAuthState('meta', projectId);
  const env = await getProjectMetaEnv(app, projectId);
  if (!env) {
    throw new IntegrationUnavailableError('Meta API credentials (META_APP_ID & META_APP_SECRET) are not configured for this project. Please enter and save your credentials first.');
  }
  const params = new URLSearchParams({
    client_id: env.appId,
    redirect_uri: redirectUriFor('meta'),
    response_type: 'code',
    scope: SCOPES,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}


async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH}${path}?${new URLSearchParams(params).toString()}`);
  } catch {
    throw new IntegrationRequestError('Could not reach Meta.');
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new IntegrationRequestError(detail?.error?.message ?? 'Meta request failed.');
  }
  return (await res.json()) as T;
}

async function graphPost<T>(path: string, params: Record<string, string>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
  } catch {
    throw new IntegrationRequestError('Could not reach Meta.');
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new IntegrationRequestError(detail?.error?.message ?? 'Meta request failed.');
  }
  return (await res.json()) as T;
}

/**
 * Exchange the OAuth code for a short-lived token, upgrade it to a long-lived
 * one (~60 days), and persist it encrypted. Meta has no refresh tokens — when
 * the long-lived token lapses the status flips to ERROR and the user reconnects.
 */
export async function handleMetaCallback(app: FastifyInstance, code: string, projectId?: string): Promise<void> {
  if (code === 'mock-code') {
    const data = {
      status: 'CONNECTED' as const,
      accessTokenEnc: encrypt('mock-access-token'),
      refreshTokenEnc: null,
      tokenExpiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000), // 60 days
      accountId: 'mock-meta-id',
      accountName: 'Mock Meta Brand Page',
      scopes: SCOPES,
      errorMessage: null,
      connectedAt: new Date(),
    };
    await app.prisma.integrationConnection.upsert({
      where: { projectId_provider: { projectId: (projectId ?? null) as string, provider: 'META' } },
      update: data,
      create: { provider: 'META', projectId: projectId ?? null, ...data },
    });
    return;
  }

  const env = await getProjectMetaEnv(app, projectId);
  if (!env) {
    throw new IntegrationUnavailableError('Meta credentials not configured for this project. Add App ID & Secret in the Social Credentials tab.');
  }
  const { appId, appSecret } = env;

  const shortLived = await graphGet<{ access_token: string }>('/oauth/access_token', {
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUriFor('meta'),
    code,
  });

  const longLived = await graphGet<{ access_token: string; expires_in?: number }>('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLived.access_token,
  });

  let accountId: string | null = null;
  let accountName: string | null = null;
  try {
    const me = await graphGet<{ id?: string; name?: string }>('/me', {
      access_token: longLived.access_token,
      fields: 'id,name',
    });
    accountId = me.id ?? null;
    accountName = me.name ?? null;
  } catch (err) {
    app.log.warn({ err }, 'Could not fetch Meta account info');
  }

  const data = {
    status: 'CONNECTED' as const,
    accessTokenEnc: encrypt(longLived.access_token),
    refreshTokenEnc: null,
    tokenExpiresAt: longLived.expires_in ? new Date(Date.now() + longLived.expires_in * 1000) : null,
    accountId,
    accountName,
    scopes: SCOPES,
    errorMessage: null,
    connectedAt: new Date(),
  };

  const targetProjectId = projectId ?? null;
  const existingConn = await app.prisma.integrationConnection.findFirst({
    where: { projectId: targetProjectId, provider: 'META' },
  });
  if (existingConn) {
    await app.prisma.integrationConnection.update({
      where: { id: existingConn.id },
      data,
    });
  } else {
    await app.prisma.integrationConnection.create({
      data: { provider: 'META', projectId: targetProjectId, ...data },
    });
  }
}


/** Return the stored long-lived Meta token; flags the connection when expired. */
export async function getMetaAccessToken(app: FastifyInstance, projectId?: string): Promise<string> {
  let conn = null;
  if (projectId) {
    conn = await app.prisma.integrationConnection.findUnique({
      where: { projectId_provider: { projectId, provider: 'META' } }
    });
  }
  if (!conn || conn.status !== 'CONNECTED' || !conn.accessTokenEnc) {
    conn = await app.prisma.integrationConnection.findUnique({
      where: { projectId_provider: { projectId: null as unknown as string, provider: 'META' } }
    });
  }
  if (!conn || conn.status !== 'CONNECTED' || !conn.accessTokenEnc) {
    throw new IntegrationUnavailableError('Meta is not connected.');
  }
  if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() <= Date.now()) {
    await app.prisma.integrationConnection.update({
      where: { projectId_provider: { projectId: (conn.projectId ?? null) as string, provider: 'META' } },
      data: { status: 'ERROR', errorMessage: 'Long-lived token expired — reconnect Meta.' },
    });
    throw new IntegrationUnavailableError('Meta token expired — reconnect Meta.');
  }
  return decrypt(conn.accessTokenEnc);
}

// ── Marketing API insights (Task 7) ─────────────────────────────────────────

export interface MetaAdCampaign {
  id: string;
  name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number; // 0..1
  cpc: number;
}

export interface MetaAdsSummary {
  accountId: string;
  rangeDays: number;
  totals: { spend: number; impressions: number; clicks: number; conversions: number };
  campaigns: MetaAdCampaign[];
}

interface InsightRow {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
}

const num = (v?: string) => Number(v ?? 0) || 0;

/** Campaign-level insights for one ad account (`act_<id>`). */
export async function fetchMetaAdsCampaigns(
  app: FastifyInstance,
  accountId: string,
  rangeDays: number,
  projectId?: string,
): Promise<MetaAdsSummary> {
  const token = await getMetaAccessToken(app, projectId);
  if (token === 'mock-access-token') {
    const campaigns: MetaAdCampaign[] = [
      { id: 'meta-c1', name: 'Summer Organic Produce Video Lead Gen', status: 'ACTIVE', spend: 410.20, impressions: 18400, clicks: 1250, conversions: 78, ctr: 1250/18400, cpc: 410.20/1250 },
      { id: 'meta-c2', name: 'Local Berlin Veg Box Branding Retargeting', status: 'ACTIVE', spend: 220.50, impressions: 9600, clicks: 480, conversions: 31, ctr: 480/9600, cpc: 220.50/480 },
      { id: 'meta-c3', name: 'Sustainable Packaging Stories Reels', status: 'PAUSED', spend: 85.00, impressions: 4500, clicks: 180, conversions: 12, ctr: 180/4500, cpc: 85.00/180 },
    ];
    return {
      accountId,
      rangeDays,
      totals: campaigns.reduce(
        (acc, c) => ({
          spend: acc.spend + c.spend,
          impressions: acc.impressions + c.impressions,
          clicks: acc.clicks + c.clicks,
          conversions: acc.conversions + c.conversions,
        }),
        { spend: 0, impressions: 0, clicks: 0, conversions: 0 },
      ),
      campaigns,
    };
  }
  const actId = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const preset = rangeDays <= 7 ? 'last_7d' : rangeDays <= 30 ? 'last_30d' : 'last_90d';

  const { data } = await graphGet<{ data?: InsightRow[] }>(`/${actId}/insights`, {
    access_token: token,
    level: 'campaign',
    date_preset: preset,
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,actions',
    limit: '50',
  });

  // Meta reports campaign status separately from insights
  const statuses = new Map<string, string>();
  try {
    const res = await graphGet<{ data?: Array<{ id?: string; status?: string }> }>(`/${actId}/campaigns`, {
      access_token: token,
      fields: 'id,status',
      limit: '100',
    });
    for (const c of res.data ?? []) if (c.id) statuses.set(c.id, c.status ?? 'UNKNOWN');
  } catch (err) {
    app.log.warn({ err }, 'Could not fetch Meta campaign statuses');
  }

  const campaigns: MetaAdCampaign[] = (data ?? []).map((r) => ({
    id: r.campaign_id ?? '',
    name: r.campaign_name ?? '',
    status: statuses.get(r.campaign_id ?? '') ?? 'UNKNOWN',
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    // Meta buries conversions in the actions list
    conversions: num(r.actions?.find((a) => a.action_type === 'purchase' || a.action_type === 'lead' || a.action_type === 'offsite_conversion')?.value),
    ctr: num(r.ctr) / 100, // Meta returns percentage
    cpc: num(r.cpc),
  }));

  return {
    accountId: actId,
    rangeDays,
    totals: campaigns.reduce(
      (acc, c) => ({
        spend: acc.spend + c.spend,
        impressions: acc.impressions + c.impressions,
        clicks: acc.clicks + c.clicks,
        conversions: acc.conversions + c.conversions,
      }),
      { spend: 0, impressions: 0, clicks: 0, conversions: 0 },
    ),
    campaigns,
  };
}

// ── Publishing (Task 8) ─────────────────────────────────────────────────────

export interface PublishResult {
  externalPostId: string;
  externalUrl: string | null;
}

interface PageInfo {
  id: string;
  access_token: string;
  instagram_business_account?: { id: string };
}

/** First managed FB Page (with its page token + linked IG business account). */
async function getFirstPage(app: FastifyInstance, projectId?: string): Promise<PageInfo> {
  const token = await getMetaAccessToken(app, projectId);
  const { data } = await graphGet<{ data?: PageInfo[] }>('/me/accounts', {
    access_token: token,
    fields: 'id,name,access_token,instagram_business_account',
  });
  const page = data?.[0];
  if (!page) throw new IntegrationUnavailableError('No Facebook Page found on the connected Meta account.');
  return page;
}

/** Publish a text (+ optional photo) post to the connected Facebook Page. */
export async function publishToFacebook(
  app: FastifyInstance,
  message: string,
  imageUrl?: string | null,
  projectId?: string,
): Promise<PublishResult> {
  const token = await getMetaAccessToken(app, projectId);
  if (token === 'mock-access-token') {
    const postId = `mock-fb-post-${Math.random().toString(36).substring(2, 10)}`;
    return { externalPostId: postId, externalUrl: `https://www.facebook.com/${postId}` };
  }
  const page = await getFirstPage(app, projectId);

  if (imageUrl && /^https?:\/\//.test(imageUrl)) {
    const res = await graphPost<{ post_id?: string; id?: string }>(`/${page.id}/photos`, {
      access_token: page.access_token,
      url: imageUrl,
      caption: message,
    });
    const postId = res.post_id ?? res.id ?? '';
    return { externalPostId: postId, externalUrl: postId ? `https://www.facebook.com/${postId}` : null };
  }

  const res = await graphPost<{ id?: string }>(`/${page.id}/feed`, {
    access_token: page.access_token,
    message,
  });
  return { externalPostId: res.id ?? '', externalUrl: res.id ? `https://www.facebook.com/${res.id}` : null };
}

/** Publish an image post to the IG business account linked to the FB Page. */
export async function publishToInstagram(
  app: FastifyInstance,
  caption: string,
  imageUrl: string,
  projectId?: string,
): Promise<PublishResult> {
  const token = await getMetaAccessToken(app, projectId);
  if (token === 'mock-access-token') {
    const postId = `mock-ig-post-${Math.random().toString(36).substring(2, 10)}`;
    return { externalPostId: postId, externalUrl: `https://www.instagram.com/p/${postId}` };
  }
  if (!/^https?:\/\//.test(imageUrl)) {
    throw new IntegrationRequestError('Instagram publishing needs a public image URL (base64 data URIs are not supported by the Graph API).', 422);
  }
  const page = await getFirstPage(app, projectId);
  const igId = page.instagram_business_account?.id;
  if (!igId) throw new IntegrationUnavailableError('No Instagram business account is linked to the connected Facebook Page.');

  const container = await graphPost<{ id?: string }>(`/${igId}/media`, {
    access_token: token,
    image_url: imageUrl,
    caption,
  });
  if (!container.id) throw new IntegrationRequestError('Instagram media container creation failed.');

  const published = await graphPost<{ id?: string }>(`/${igId}/media_publish`, {
    access_token: token,
    creation_id: container.id,
  });
  return { externalPostId: published.id ?? '', externalUrl: null };
}
