const CACHE_TTL = 86400;
const TOKEN_URI = 'https://oauth2.googleapis.com/token';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === '/analytics' && request.method === 'GET') {
      return handleAnalytics(url, ctx, env);
    }

    return new Response('Not Found', { status: 404 });
  }
};

async function handleAnalytics(url, ctx, env) {
  try {
    const period = url.searchParams.get('period') || '7d';
    const { startDate, endDate, label } = parsePeriod(period);

    if (!startDate) {
      return jsonResponse({ error: 'Invalid period. Use: today, yesterday, 7d, 30d, 90d' }, 400);
    }

    const noCache = url.searchParams.get('nocache') === '1';

    const cacheKey = `ga4-v3-${startDate}-${endDate}`;
    const cacheUrl = new URL(url.toString());
    cacheUrl.searchParams.delete('nocache');
    cacheUrl.searchParams.set('_ck', cacheKey);
    const cacheRequest = new Request(cacheUrl.toString());

    if (!noCache) {
      const cached = await caches.default.match(cacheRequest);
      if (cached) {
        const cachedData = await cached.json();
        return jsonResponse({ ...cachedData, cached: true });
      }
    }

    const accessToken = await getAccessToken(env);
    const apiUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${env.GA4_PROPERTY_ID}:runReport`;
    const headers = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    const dateRanges = [{ startDate, endDate }];

    const [totalsRes, pagesRes, countriesRes, referralsRes, referrersRes, searchEnginesRes] = await Promise.all([
      fetch(apiUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          dateRanges,
          metrics: [
            { name: 'activeUsers' },
            { name: 'sessions' },
            { name: 'screenPageViews' }
          ]
        })
      }),
      fetch(apiUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          dateRanges,
          dimensions: [{ name: 'pageTitle' }, { name: 'pagePath' }],
          metrics: [{ name: 'screenPageViews' }],
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
          limit: 5
        })
      }),
      fetch(apiUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          dateRanges,
          dimensions: [{ name: 'countryId' }],
          metrics: [{ name: 'activeUsers' }],
          orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
          limit: 5
        })
      }),
      fetch(apiUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          dateRanges,
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 5
        })
      }),
      fetch(apiUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          dateRanges,
          dimensions: [{ name: 'sessionSource' }],
          metrics: [{ name: 'sessions' }],
          dimensionFilter: {
            filter: {
              fieldName: 'sessionDefaultChannelGroup',
              stringFilter: { value: 'Referral', matchType: 'EXACT' }
            }
          },
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 5
        })
      }),
      fetch(apiUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          dateRanges,
          dimensions: [{ name: 'sessionSource' }],
          metrics: [{ name: 'sessions' }],
          dimensionFilter: {
            filter: {
              fieldName: 'sessionDefaultChannelGroup',
              stringFilter: { value: 'Organic Search', matchType: 'EXACT' }
            }
          },
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 5
        })
      })
    ]);

    if (!totalsRes.ok) {
      const err = await totalsRes.text();
      return jsonResponse({ error: 'GA4 API error', status: totalsRes.status, details: err }, totalsRes.status);
    }

    const [totalsData, pagesData, countriesData, referralsData, referrersData, searchEnginesData] = await Promise.all([
      totalsRes.json(), pagesRes.json(), countriesRes.json(), referralsRes.json(), referrersRes.json(), searchEnginesRes.json()
    ]);

    const totals = parseTotals(totalsData);
    const topPages = parseTopPages(pagesData);
    const topCountries = parseTopCountries(countriesData);
    const topReferrals = parseTopDimension(referralsData, 'sessions', true);
    const topReferrers = parseTopDimension(referrersData, 'sessions');
    const topSearchEngines = parseTopDimension(searchEnginesData, 'sessions');

    const result = { period: label, startDate, endDate, totals, topPages, topCountries, topReferrals, topReferrers, topSearchEngines, fetchTime: new Date().toISOString() };

    const responseToCache = new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_TTL}` }
    });
    ctx.waitUntil(caches.default.put(cacheRequest, responseToCache.clone()));

    return jsonResponse({ ...result, cached: false });

  } catch (error) {
    return jsonResponse({ error: 'Internal server error', message: error.message }, 500);
  }
}

function parsePeriod(period) {
  const today = new Date();
  const fmt = d => d.toISOString().split('T')[0];

  switch (period) {
    case 'today':
      return { startDate: fmt(today), endDate: fmt(today), label: 'Today' };
    case 'yesterday': {
      const d = new Date(today); d.setDate(d.getDate() - 1);
      return { startDate: fmt(d), endDate: fmt(d), label: 'Yesterday' };
    }
    case '3d': {
      const d = new Date(today); d.setDate(d.getDate() - 2);
      return { startDate: fmt(d), endDate: fmt(today), label: 'Last 3 days' };
    }
    case '7d': {
      const d = new Date(today); d.setDate(d.getDate() - 6);
      return { startDate: fmt(d), endDate: fmt(today), label: 'Last 7 days' };
    }
    case '30d': {
      const d = new Date(today); d.setDate(d.getDate() - 29);
      return { startDate: fmt(d), endDate: fmt(today), label: 'Last 30 days' };
    }
    case '90d': {
      const d = new Date(today); d.setDate(d.getDate() - 89);
      return { startDate: fmt(d), endDate: fmt(today), label: 'Last 90 days' };
    }
    default:
      return { startDate: null, endDate: null, label: null };
  }
}

function parseTotals(data) {
  if (data.rows && data.rows.length > 0) {
    const row = data.rows[0];
    return {
      users: parseInt(row.metricValues[0].value || 0),
      sessions: parseInt(row.metricValues[1].value || 0),
      pageViews: parseInt(row.metricValues[2].value || 0)
    };
  }
  return { users: 0, sessions: 0, pageViews: 0 };
}

const countryNames = new Intl.DisplayNames(['ar'], { type: 'region' });

function parseTopCountries(data) {
  if (!data.rows) return [];
  return data.rows.map(row => {
    const code = row.dimensionValues[0].value || '';
    let name;
    try { name = countryNames.of(code); } catch { name = code; }
    return { name: name || code, users: parseInt(row.metricValues[0].value || 0) };
  });
}

function parseTopPages(data) {
  if (!data.rows) return [];
  return data.rows.map(row => ({
    name: row.dimensionValues[0].value || '(not set)',
    path: row.dimensionValues[1].value || '/',
    pageViews: parseInt(row.metricValues[0].value || 0)
  }));
}

const CHANNEL_AR = {
  'Direct': 'مباشر',
  'Organic Search': 'بحث عضوي',
  'Referral': 'من مواقع أخرى',
  'Organic Social': 'تواصل اجتماعي',
  'Paid Search': 'بحث مدفوع',
  'Paid Social': 'إعلان اجتماعي',
  'Email': 'بريد إلكتروني',
  'Display': 'إعلانات مرئية',
  'Affiliates': 'شركاء',
  'Unassigned': 'غير مصنّف',
  '(not set)': 'غير محدد'
};

function parseTopDimension(data, metricLabel, localize) {
  if (!data.rows) return [];
  return data.rows.map(row => {
    const raw = row.dimensionValues[0].value || '(not set)';
    return {
      name: localize ? (CHANNEL_AR[raw] || raw) : raw,
      [metricLabel]: parseInt(row.metricValues[0].value || 0)
    };
  });
}

// --- GA4 JWT Auth ---

async function getAccessToken(env) {
  const jwt = await createJWT(env);
  const response = await fetch(TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function createJWT(env) {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: env.GCP_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: TOKEN_URI,
    iat: now,
    exp: now + 3600
  };

  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPrivateKey(env.GCP_PRIVATE_KEY);
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${b64urlBuffer(signature)}`;
}

async function importPrivateKey(pem) {
  const pemBody = pem
    .replace(/\\n/g, '\n')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const binaryDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function b64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}
