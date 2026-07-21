import { FastifyInstance } from 'fastify';
import { getGoogleAccessToken } from './google-oauth.js';
import { IntegrationRequestError, IntegrationUnavailableError } from './errors.js';

const API = 'https://googleads.googleapis.com/v18';

export interface AdCampaign {
  id: string;
  name: string;
  status: string;
  spend: number;      // account currency
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;        // 0..1
  cpc: number;        // account currency
}

export interface AdAccountSummary {
  accountId: string;
  rangeDays: number;
  totals: { spend: number; impressions: number; clicks: number; conversions: number };
  campaigns: AdCampaign[];
}

interface SearchStreamChunk {
  results?: Array<{
    campaign?: { id?: string; name?: string; status?: string };
    metrics?: {
      costMicros?: string;
      impressions?: string;
      clicks?: string;
      conversions?: number | string;
      ctr?: number;
      averageCpc?: string;
    };
  }>;
}

function requireDeveloperToken(): string {
  const token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!token) {
    throw new IntegrationUnavailableError('Google Ads is not configured (missing GOOGLE_ADS_DEVELOPER_TOKEN).');
  }
  return token;
}

const num = (v: string | number | undefined) => Number(v ?? 0) || 0;

export async function fetchGoogleAdsCampaigns(
  app: FastifyInstance,
  customerId: string,
  rangeDays: number,
  projectId?: string,
): Promise<AdAccountSummary> {
  const accessToken = await getGoogleAccessToken(app, projectId);
  if (accessToken === 'mock-access-token') {
    const campaigns: AdCampaign[] = [
      { id: '1', name: 'Summer Organic Produce Search', status: 'ENABLED', spend: 320.50, impressions: 12500, clicks: 850, conversions: 42, ctr: 850/12500, cpc: 320.50/850 },
      { id: '2', name: 'Berlin Grocery Delivery Retargeting', status: 'ENABLED', spend: 180.20, impressions: 8400, clicks: 420, conversions: 28, ctr: 420/8400, cpc: 180.20/420 },
      { id: '3', name: 'Zero Waste Sustainable Staple Branding', status: 'PAUSED', spend: 50.00, impressions: 3100, clicks: 95, conversions: 3, ctr: 95/3100, cpc: 50.00/95 },
    ];
    const totals = campaigns.reduce(
      (acc, c) => {
        acc.spend += c.spend;
        acc.impressions += c.impressions;
        acc.clicks += c.clicks;
        acc.conversions += c.conversions;
        return acc;
      },
      { spend: 0, impressions: 0, clicks: 0, conversions: 0 }
    );
    return {
      accountId: customerId,
      rangeDays,
      totals,
      campaigns,
    };
  }

  let developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (projectId) {
    const proj = await app.prisma.projectGoogleCredentials.findUnique({ where: { projectId } });
    if (proj?.developerTokenEnc) {
      const { decrypt } = await import('../../utils/encryption.js');
      developerToken = decrypt(proj.developerTokenEnc);
    }
  }
  if (!developerToken) {
    throw new IntegrationUnavailableError('Google Ads is not configured (missing GOOGLE_ADS_DEVELOPER_TOKEN).');
  }
  const cid = customerId.replace(/-/g, '');

  // GAQL only predefines a few relative ranges — explicit dates cover any window
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - rangeDays * 86_400_000).toISOString().slice(0, 10);
  const query = `
    SELECT campaign.id, campaign.name, campaign.status,
           metrics.cost_micros, metrics.impressions, metrics.clicks,
           metrics.conversions, metrics.ctr, metrics.average_cpc
    FROM campaign
    WHERE segments.date BETWEEN '${start}' AND '${end}'
    ORDER BY metrics.cost_micros DESC`;

  let res: Response;
  try {
    res = await fetch(`${API}/customers/${cid}/googleAds:searchStream`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': developerToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
  } catch {
    throw new IntegrationRequestError('Could not reach Google Ads.');
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as
      | Array<{ error?: { message?: string } }>
      | { error?: { message?: string } }
      | null;
    const message = Array.isArray(detail) ? detail[0]?.error?.message : detail?.error?.message;
    throw new IntegrationRequestError(message ?? 'Google Ads request failed.');
  }

  // searchStream returns an array of result chunks
  const chunks = (await res.json()) as SearchStreamChunk[];
  const campaigns: AdCampaign[] = chunks
    .flatMap((c) => c.results ?? [])
    .map((r) => ({
      id: r.campaign?.id ?? '',
      name: r.campaign?.name ?? '',
      status: r.campaign?.status ?? 'UNKNOWN',
      spend: num(r.metrics?.costMicros) / 1_000_000,
      impressions: num(r.metrics?.impressions),
      clicks: num(r.metrics?.clicks),
      conversions: num(r.metrics?.conversions),
      ctr: num(r.metrics?.ctr),
      cpc: num(r.metrics?.averageCpc) / 1_000_000,
    }));

  return {
    accountId: customerId,
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
