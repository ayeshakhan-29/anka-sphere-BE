import { FastifyInstance } from 'fastify';
import { getGoogleAccessToken } from './google-oauth.js';
import { IntegrationRequestError, IntegrationUnavailableError } from './errors.js';

const DATA_API = 'https://analyticsdata.googleapis.com/v1beta';

export interface Ga4Metrics {
  propertyId: string;
  rangeDays: number;
  sessions: number;
  totalUsers: number;
  newUsers: number;
  conversions: number;
  engagementRate: number; // 0..1
  averageSessionDuration: number; // seconds
  topPages: Array<{ path: string; sessions: number; users: number }>;
  sessionsByDay: Array<{ date: string; sessions: number }>;
}

interface RunReportResponse {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
}

/**
 * project.analyticsPropertyId may hold either the numeric property ID or a
 * G-XXXX measurement ID; the Data API only accepts the numeric form.
 */
function normalizePropertyId(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  if (/^properties\/\d+$/.test(trimmed)) return trimmed.replace('properties/', '');
  throw new IntegrationUnavailableError(
    `GA4 needs the numeric property ID (found "${raw}"). Measurement IDs (G-XXXX) are not accepted by the Data API — copy the property ID from GA4 Admin → Property settings.`,
  );
}

async function runReport(token: string, propertyId: string, body: object): Promise<RunReportResponse> {
  let res: Response;
  try {
    res = await fetch(`${DATA_API}/properties/${propertyId}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new IntegrationRequestError('Could not reach Google Analytics.');
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new IntegrationRequestError(detail?.error?.message ?? 'GA4 report request failed.');
  }
  return (await res.json()) as RunReportResponse;
}

const num = (v?: string) => Number(v ?? 0) || 0;

export async function fetchGa4Metrics(
  app: FastifyInstance,
  rawPropertyId: string,
  rangeDays: number,
): Promise<Ga4Metrics> {
  const token = await getGoogleAccessToken(app);
  if (token === 'mock-access-token') {
    const sessionsByDay = Array.from({ length: rangeDays }, (_, i) => {
      const date = new Date(Date.now() - (rangeDays - 1 - i) * 86_400_000).toISOString().slice(0, 10);
      return { date, sessions: Math.floor(Math.random() * 200) + 100 };
    });
    const sessions = sessionsByDay.reduce((sum, d) => sum + d.sessions, 0);
    return {
      propertyId: rawPropertyId,
      rangeDays,
      sessions,
      totalUsers: Math.floor(sessions * 0.8),
      newUsers: Math.floor(sessions * 0.6),
      conversions: Math.floor(sessions * 0.05),
      engagementRate: 0.68,
      averageSessionDuration: 145,
      topPages: [
        { path: '/', sessions: Math.floor(sessions * 0.5), users: Math.floor(sessions * 0.4) },
        { path: '/about', sessions: Math.floor(sessions * 0.2), users: Math.floor(sessions * 0.15) },
        { path: '/pricing', sessions: Math.floor(sessions * 0.15), users: Math.floor(sessions * 0.12) },
        { path: '/blog', sessions: Math.floor(sessions * 0.1), users: Math.floor(sessions * 0.08) },
      ],
      sessionsByDay,
    };
  }

  const propertyId = normalizePropertyId(rawPropertyId);
  const dateRanges = [{ startDate: `${rangeDays}daysAgo`, endDate: 'today' }];

  const [totals, pages, byDay] = await Promise.all([
    runReport(token, propertyId, {
      dateRanges,
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'newUsers' },
        { name: 'conversions' },
        { name: 'engagementRate' },
        { name: 'averageSessionDuration' },
      ],
    }),
    runReport(token, propertyId, {
      dateRanges,
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 10,
    }),
    runReport(token, propertyId, {
      dateRanges,
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    }),
  ]);

  const t = totals.rows?.[0]?.metricValues ?? [];
  return {
    propertyId,
    rangeDays,
    sessions: num(t[0]?.value),
    totalUsers: num(t[1]?.value),
    newUsers: num(t[2]?.value),
    conversions: num(t[3]?.value),
    engagementRate: num(t[4]?.value),
    averageSessionDuration: num(t[5]?.value),
    topPages: (pages.rows ?? []).map((r) => ({
      path: r.dimensionValues?.[0]?.value ?? '',
      sessions: num(r.metricValues?.[0]?.value),
      users: num(r.metricValues?.[1]?.value),
    })),
    sessionsByDay: (byDay.rows ?? []).map((r) => ({
      // GA4 returns YYYYMMDD — normalize to ISO for the frontend
      date: (r.dimensionValues?.[0]?.value ?? '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
      sessions: num(r.metricValues?.[0]?.value),
    })),
  };
}
