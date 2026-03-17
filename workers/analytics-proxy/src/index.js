const GA4_PROPERTY_ID = '528971922';
const GA4_API_URL = `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`;
const CACHE_TTL = 86400;

const SERVICE_ACCOUNT = {
  client_email: 'ebrahimalzaabi-com@ebrahimalzaabi-com.iam.gserviceaccount.com',
  private_key: `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCzKKoZhreChDQf
g+esOA119vL0QLUtw8thZ5sKBHWJh22PqCe2UMPB1QNXPQExNzd+brPdzydT13Ok
kBYnDJkS6ewS+z9cu7QenmDN8Rtw5myMG/l5Dlx02RV4uXmLs1+wU450nkghOLAZ
J28+vktfeeSEu2/3xWW0NtCVGE4ojP3ZF1Pa2aADKFyvlCQUnXuz24n76DsPmAYC
GQa6/JpJeT4T3T4yCwYmcPZAPNXOaGWxGrMwygNLc0WCnuiMgPflUg3aYNJKlNFz
dEfrwMOj1nFBi8WjoliSVS3thaclu8ERVxBEOpu/0H0vON0Z+jPwsfCfF2td1jMn
HD2sp+3JAgMBAAECggEADk9AqtJGRP/vM9cywWAmvxXO2PB0KCgbzfda/EVX5/iv
qQo6xcaUpB4x6p1eQ4KQBaKs7hn2H621OF8jzdGlRkv1xZxYtrztSYbH35sS4IUf
BV/UoLUjcFfIbcCOszhL+8bouWrNAw5GjnPGYGINnh4bwPhBnK4hDfBU35u13mom
QulmhlE34zeI7xJ4fB3byHbDTLTnd1Ba/5qS/Msj1YbD5n7CkGGVjOjDXHff5THP
LDVUt5mKm73OXOb5oWUdA5zvHjW5Oaz121ibX9okMdi+f+gsKiN/vcMc+9co0JkJ
faP4e5FXIICVQSroNyUcRCW/IrZgDPwH94Ve62VaKwKBgQDaF1GeUUn6b7JTR2uC
NRb6G3wnVmEGQh8bIS84owjgsVu9WHCPKNqo7hUgp09eAorhMdWXhWkt3b8dt2Rw
GUx66VJ7JPRKxdAbWmQRletvxkFW1z9oZI98FvKRaAvFW1SNB9PozKUW3oQWGLkr
cd0ZcHv7fdF0nJiK1Ald+bME2wKBgQDSTO1gEB1qhluk+PmU6KEwhGqlNaUg4xj/
Ob9/JAzVBcIgAdd+ABwMAvZQ7X/gKLQyv9m86rlFQ22tJrDrgiiPPWN6MxiuxVcP
03JuBGEM87cshxI8UTW8wONeoftBiV1xL5A0xIv5CkvNodMux+lKqTGRC5U0I5yi
y6j+noZnKwKBgDTuZ+7Gx++yYFN6CAvIGtWFCjL58f502dvZx/41A5iVMzDXYCo+
viM19YbBVK/6af6R+8cUqBxrr1DlC8lxOnCyZERjCa+EJygcXiEug7/THFSZVVhe
37w8TY8g84poyjKYbcQYtxC/3MsIIRj8P69G77BwLv/gad137PYT/nD1AoGALKrq
QF0r4lRnYsL/QAGpOwTlIfIjALk7tfouEnM1xolSkjnR65FaY7K9XrMTVilPHPhi
5x1z/KI1yXFOYrdipgoD9xCjTXvc4h+nTnbfpkCdx3dpCCa3oz/VC2ScWW8zybaw
ioS0tlDZiPO2R1lu08zcGlK7fjeSLYHUg0Boi8ECgYAtJ4+9ENLvz7xAvmGuJ99Y
ytoJ1KeJRkcSC0o6c4g0LOTjDABiHZSQ9L+IPWRtkXuu0RPgIB0wxjMt1eFp9zbd
SD0JtEjhg3QtthJSqNsgwk9nD2T7XlUVRIw0ysF6rA1yvfltvPskQu5nxoqddGtd
KQgDXx45teVou/E5bZma7Q==
-----END PRIVATE KEY-----`,
  token_uri: 'https://oauth2.googleapis.com/token'
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === '/analytics' && request.method === 'GET') {
      return handleAnalytics(url, ctx);
    }

    return new Response('Not Found', { status: 404 });
  }
};

async function handleAnalytics(url, ctx) {
  try {
    const period = url.searchParams.get('period') || '7d';
    const { startDate, endDate, label } = parsePeriod(period);

    if (!startDate) {
      return jsonResponse({ error: 'Invalid period. Use: today, yesterday, 7d, 30d, 90d, or start=YYYY-MM-DD&end=YYYY-MM-DD' }, 400);
    }

    const cacheKey = `ga4-${startDate}-${endDate}`;
    const cache = caches.default;
    const cacheUrl = new URL(url.toString());
    cacheUrl.searchParams.set('_ck', cacheKey);
    const cacheRequest = new Request(cacheUrl.toString());

    const cached = await cache.match(cacheRequest);
    if (cached) {
      const cachedData = await cached.json();
      return jsonResponse({ ...cachedData, cached: true });
    }

    const accessToken = await getAccessToken();

    const gaResponse = await fetch(GA4_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
          { name: 'screenPageViews' }
        ],
        orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }]
      })
    });

    if (!gaResponse.ok) {
      const err = await gaResponse.text();
      return jsonResponse({ error: 'GA4 API error', status: gaResponse.status, details: err }, gaResponse.status);
    }

    const data = await gaResponse.json();
    const result = parseGA4Response(data, label, startDate, endDate);

    const responseToCache = new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_TTL}` }
    });
    ctx.waitUntil(cache.put(cacheRequest, responseToCache.clone()));

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

function parseGA4Response(data, label, startDate, endDate) {
  let totalUsers = 0;
  let totalSessions = 0;
  let totalPageViews = 0;
  const daily = [];

  if (data.rows) {
    data.rows.forEach(row => {
      const dateStr = row.dimensionValues[0].value;
      const users = parseInt(row.metricValues[0].value || 0);
      const sessions = parseInt(row.metricValues[1].value || 0);
      const pageViews = parseInt(row.metricValues[2].value || 0);

      totalUsers += users;
      totalSessions += sessions;
      totalPageViews += pageViews;

      daily.push({
        date: `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`,
        users,
        sessions,
        pageViews
      });
    });
  }

  return {
    period: label,
    startDate,
    endDate,
    totals: { users: totalUsers, sessions: totalSessions, pageViews: totalPageViews },
    daily,
    fetchTime: new Date().toISOString()
  };
}

// --- GA4 JWT Auth ---

async function getAccessToken() {
  const jwt = await createJWT();
  const response = await fetch(SERVICE_ACCOUNT.token_uri, {
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

async function createJWT() {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: SERVICE_ACCOUNT.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: SERVICE_ACCOUNT.token_uri,
    iat: now,
    exp: now + 3600
  };

  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPrivateKey(SERVICE_ACCOUNT.private_key);
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${b64urlBuffer(signature)}`;
}

async function importPrivateKey(pem) {
  const pemBody = pem
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
