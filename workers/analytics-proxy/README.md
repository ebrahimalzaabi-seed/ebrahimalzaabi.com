# Analytics Proxy Worker

Cloudflare Worker that proxies the Google Analytics 4 Data API with 24-hour caching.

## Secrets

The worker requires three environment variables. **Never commit these to the repo.**

| Variable | Description |
|---|---|
| `GA4_PROPERTY_ID` | GA4 numeric property ID |
| `GCP_CLIENT_EMAIL` | Service account email |
| `GCP_PRIVATE_KEY` | Service account private key (PEM format) |

### Local Development

Create a `.dev.vars` file in this directory (already gitignored):

```
GA4_PROPERTY_ID=528971922
GCP_CLIENT_EMAIL=your-sa@project.iam.gserviceaccount.com
GCP_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----
```

Then run:

```bash
cd workers/analytics-proxy
npm install
npm run dev
```

The worker will be available at `http://localhost:8787`

### Production Deployment

Set secrets via wrangler before deploying:

```bash
npx wrangler secret put GA4_PROPERTY_ID
npx wrangler secret put GCP_CLIENT_EMAIL
npx wrangler secret put GCP_PRIVATE_KEY
```

Then deploy:

```bash
npm run deploy
```

## API

### GET /analytics?period={period}

**Supported periods:** `today`, `yesterday`, `3d`, `7d`, `30d`, `90d`

**Example:**
```bash
curl http://localhost:8787/analytics?period=7d
```

**Response:**
```json
{
  "period": "Last 7 days",
  "startDate": "2026-03-11",
  "endDate": "2026-03-17",
  "totals": {
    "users": 120,
    "sessions": 185,
    "pageViews": 430
  },
  "daily": [
    { "date": "2026-03-11", "users": 15, "sessions": 22, "pageViews": 55 },
    { "date": "2026-03-12", "users": 18, "sessions": 28, "pageViews": 64 }
  ],
  "fetchTime": "2026-03-17T22:00:00.000Z",
  "cached": false
}
```

## Caching

- TTL: 24 hours (86400 seconds)
- Stored in Cloudflare edge cache
- Cached responses include `"cached": true`
