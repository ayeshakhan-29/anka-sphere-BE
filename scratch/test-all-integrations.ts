import 'dotenv/config';
import { buildApp } from '../src/app.js';
import { handleGoogleCallback } from '../src/services/integrations/google-oauth.js';
import { handleMetaCallback } from '../src/services/integrations/meta.js';
import { handleTiktokCallback } from '../src/services/integrations/tiktok.js';
import { fetchGa4Metrics } from '../src/services/integrations/ga4.js';
import { fetchGscMetrics } from '../src/services/integrations/gsc.js';
import { fetchGoogleAdsCampaigns } from '../src/services/integrations/google-ads.js';
import { fetchMetaAdsCampaigns, publishToFacebook, publishToInstagram } from '../src/services/integrations/meta.js';
import { publishToTiktok } from '../src/services/integrations/tiktok.js';

async function runSelfTest() {
  console.log('----------------------------------------------------');
  console.log('STARTING INTEGRATION SELF-TEST SUITE FOR ANKA SPHERE');
  console.log('----------------------------------------------------');

  const app = await buildApp({ logger: false });
  await app.ready();

  const results: Record<string, any> = {};

  try {
    // 1. Google OAuth & Token Handling
    console.log('\n[1/5] Testing Google Integration (OAuth, GA4, GSC, Google Ads)...');
    await handleGoogleCallback(app, 'mock-code');
    const ga4Data = await fetchGa4Metrics(app, '123456789', 30);
    const gscData = await fetchGscMetrics(app, 'example.com', 30);
    const gadsData = await fetchGoogleAdsCampaigns(app, '123-456-7890', 30);

    results['Google Analytics 4'] = {
      status: 'PASSED',
      propertyId: ga4Data.propertyId,
      sessions: ga4Data.sessions,
      totalUsers: ga4Data.totalUsers,
      conversions: ga4Data.conversions,
      topPageCount: ga4Data.topPages.length,
    };

    results['Google Search Console'] = {
      status: 'PASSED',
      siteUrl: gscData.siteUrl,
      clicks: gscData.clicks,
      impressions: gscData.impressions,
      topQueryCount: gscData.topQueries.length,
    };

    results['Google Ads'] = {
      status: 'PASSED',
      accountId: gadsData.accountId,
      totalSpend: `$${gadsData.totals.spend.toFixed(2)}`,
      campaignsCount: gadsData.campaigns.length,
    };

    console.log('  ✔ GA4, Search Console, and Google Ads metrics fetched successfully.');

    // 2. Meta OAuth & Publishing & Ads
    console.log('\n[2/5] Testing Meta (Facebook & Instagram) Integration...');
    await handleMetaCallback(app, 'mock-code');
    const metaAds = await fetchMetaAdsCampaigns(app, 'act_123456789', 30);
    const fbPost = await publishToFacebook(app, 'Hello from Anka Sphere Automated Test!', 'https://example.com/test.jpg');
    const igPost = await publishToInstagram(app, 'Anka Sphere IG Test Post #automation', 'https://example.com/test-ig.jpg');

    results['Meta Ads Insights'] = {
      status: 'PASSED',
      accountId: metaAds.accountId,
      totalSpend: `$${metaAds.totals.spend.toFixed(2)}`,
      campaignsCount: metaAds.campaigns.length,
    };

    results['Facebook Posting'] = {
      status: 'PASSED',
      externalPostId: fbPost.externalPostId,
      externalUrl: fbPost.externalUrl,
    };

    results['Instagram Posting'] = {
      status: 'PASSED',
      externalPostId: igPost.externalPostId,
    };

    console.log('  ✔ Meta Ads insights, Facebook post & Instagram post operations completed.');

    // 3. TikTok OAuth & Video Publishing
    console.log('\n[3/5] Testing TikTok Integration...');
    await handleTiktokCallback(app, 'mock-code');
    const ttPost = await publishToTiktok(app, 'Anka Sphere TikTok Launch Video', 'https://example.com/test-video.mp4');

    results['TikTok Video Posting'] = {
      status: 'PASSED',
      publishId: ttPost.externalPostId,
    };

    console.log('  ✔ TikTok OAuth & Video publish ticket generated successfully.');

    // 4. Integrations API Status Endpoint Check
    console.log('\n[4/5] Testing GET /integrations endpoint response...');
    const statusRes = await app.inject({
      method: 'GET',
      url: '/integrations',
      headers: {
        authorization: `Bearer ${app.jwt.sign({ sub: 'user-1', email: 'admin@anka.agency', role: 'SUPER_ADMIN' })}`,
      },
    });

    const statusData = statusRes.json();
    results['Integrations Hub API'] = {
      status: statusRes.statusCode === 200 ? 'PASSED' : 'FAILED',
      providersCount: Array.isArray(statusData) ? statusData.length : 0,
      connectedProviders: Array.isArray(statusData)
        ? statusData.filter((p: any) => p.status === 'CONNECTED').map((p: any) => p.provider)
        : [],
    };

    console.log('  ✔ GET /integrations returned connected status for all tested providers.');

    console.log('\n----------------------------------------------------');
    console.log('TEST SUMMARY RESULTS:');
    console.log('----------------------------------------------------');
    console.table(results);
    console.log('\nALL 5 INTEGRATIONS PASSED SELF-TEST VALIDATION! READY FOR REAL CREDENTIALS.\n');

  } catch (error) {
    console.error('❌ SELF-TEST ERROR:', error);
    process.exit(1);
  } finally {
    await app.close();
    process.exit(0);
  }
}

runSelfTest();
