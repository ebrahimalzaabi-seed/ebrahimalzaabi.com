# Analytics Proxy Worker

Cloudflare Worker that proxies Microsoft Clarity Analytics API with 24-hour caching.

## Setup

```bash
cd workers/analytics-proxy
npm install
```

## Local Development

```bash
npm run dev
```

The worker will be available at `http://localhost:8787`

## API Endpoints

### GET /analytics?days={1|2|3}

Fetches analytics data for the specified number of days (last 24, 48, or 72 hours).

**Parameters:**
- `days` (optional, default: 1) - Number of days: 1, 2, or 3

**Example:**
```bash
curl http://localhost:8787/analytics?days=1
```

**Response:**
```json
{
  "period": "1 day",
  "metrics": {
    "traffic": {
      "totalSessions": 1234,
      "totalUsers": 892,
      "totalBotSessions": 45,
      "humanSessions": 1189
    },
    "popularPages": [
      {
        "url": "/",
        "title": "الرئيسية",
        "sessions": 450
      }
    ],
    "countries": [
      {
        "name": "United Arab Emirates",
        "sessions": 800,
        "users": 600
      }
    ]
  },
  "cached": false,
  "fetchTime": "2026-03-18T00:00:00.000Z"
}
```

## Caching

- Cache TTL: 24 hours (86400 seconds)
- Cache is stored in Cloudflare's edge cache
- Cached responses include `cached: true` and `cacheTime` fields

## Deployment

```bash
npm run deploy
```
