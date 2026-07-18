import { FastifyInstance } from 'fastify';
import { getGoogleAccessToken } from './google-oauth.js';
import { IntegrationRequestError } from './errors.js';

const API = 'https://searchconsole.googleapis.com/webmasters/v3/sites';

export interface GscMetrics {
  siteUrl: string;
  rangeDays: number;
  clicks: number;
  impressions: number;
  ctr: number; // 0..1
  avgPosition: number;
  topQueries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
  topPages: Array<{ page: string; clicks: number; impressions: number }>;
}

interface SearchAnalyticsResponse {
  rows?: Array<{
    keys?: string[];
    clicks?: number;
    impressions?: number;
    ctr?: number;
    position?: number;
  }>;
}

async function query(token: string, siteUrl: string, body: object): Promise<SearchAnalyticsResponse> {
  const encoded = encodeURIComponent(siteUrl);
  let res: Response;
  try {
    res = await fetch(`${API}/${encoded}/searchAnalytics/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new IntegrationRequestError('Could not reach Google Search Console.');
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new IntegrationRequestError(detail?.error?.message ?? 'Search Console request failed.');
  }
  return (await res.json()) as SearchAnalyticsResponse;
}

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

export async function fetchGscMetrics(
  app: FastifyInstance,
  siteUrl: string,
  rangeDays: number,
): Promise<GscMetrics> {
  const token = await getGoogleAccessToken(app);
  if (token === 'mock-access-token') {
    const clicks = Math.floor(Math.random() * 500) + 150;
    const impressions = clicks * 15;
    return {
      siteUrl,
      rangeDays,
      clicks,
      impressions,
      ctr: clicks / impressions,
      avgPosition: 4.8,
      topQueries: [
        { query: 'organic produce delivery', clicks: Math.floor(clicks * 0.4), impressions: Math.floor(impressions * 0.35), ctr: 0.12, position: 2.1 },
        { query: 'fresh vegetable box online', clicks: Math.floor(clicks * 0.25), impressions: Math.floor(impressions * 0.2), ctr: 0.1, position: 3.5 },
        { query: 'zero waste berlin store', clicks: Math.floor(clicks * 0.15), impressions: Math.floor(impressions * 0.12), ctr: 0.08, position: 1.8 },
        { query: 'misfits market alternative', clicks: Math.floor(clicks * 0.08), impressions: Math.floor(impressions * 0.08), ctr: 0.05, position: 5.2 },
      ],
      topPages: [
        { page: 'https://' + siteUrl + '/', clicks: Math.floor(clicks * 0.6), impressions: Math.floor(impressions * 0.55) },
        { page: 'https://' + siteUrl + '/about', clicks: Math.floor(clicks * 0.2), impressions: Math.floor(impressions * 0.18) },
        { page: 'https://' + siteUrl + '/veg-boxes', clicks: Math.floor(clicks * 0.15), impressions: Math.floor(impressions * 0.15) },
      ],
    };
  }

  // GSC data lags ~2 days; shift the window so the range is fully populated
  const range = { startDate: isoDaysAgo(rangeDays + 2), endDate: isoDaysAgo(2) };

  const [totals, queries, pages] = await Promise.all([
    query(token, siteUrl, { ...range }),
    query(token, siteUrl, { ...range, dimensions: ['query'], rowLimit: 15 }),
    query(token, siteUrl, { ...range, dimensions: ['page'], rowLimit: 10 }),
  ]);

  const t = totals.rows?.[0];
  return {
    siteUrl,
    rangeDays,
    clicks: t?.clicks ?? 0,
    impressions: t?.impressions ?? 0,
    ctr: t?.ctr ?? 0,
    avgPosition: t?.position ?? 0,
    topQueries: (queries.rows ?? []).map((r) => ({
      query: r.keys?.[0] ?? '',
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    })),
    topPages: (pages.rows ?? []).map((r) => ({
      page: r.keys?.[0] ?? '',
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
    })),
  };
}
