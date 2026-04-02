// YouTube channel ID for @ebrahim_alzaabi
const CHANNEL_ID = 'UChYrhls3RB-rZru10I0EF2w';
const RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const MAX_VIDEOS = 6;
const CACHE_TTL = 3600; // 1 hour edge cache

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Check edge cache first
    const cacheKey = new Request(new URL('/videos', request.url).toString());
    const cache = caches.default;
    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      console.log('[CACHE HIT] Returning cached YouTube videos');
      return cachedResponse;
    }

    console.log('[CACHE MISS] Fetching YouTube RSS feed');

    try {
      const response = await fetch(RSS_URL, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });

      if (!response.ok) {
        throw new Error(`RSS fetch failed: ${response.status}`);
      }

      const xml = await response.text();
      const videos = parseRSS(xml);

      const body = JSON.stringify({ success: true, videos });
      const result = new Response(body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${CACHE_TTL}`,
          ...CORS_HEADERS,
        },
      });

      // Store in edge cache
      ctx.waitUntil(cache.put(cacheKey, result.clone()));

      return result;
    } catch (err) {
      console.error('[ERROR]', err.message);
      return new Response(
        JSON.stringify({ success: false, error: err.message }),
        {
          status: 502,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
          },
        }
      );
    }
  },
};

function parseRSS(xml) {
  const videos = [];
  // Match each <entry> block
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null && videos.length < MAX_VIDEOS) {
    const entry = match[1];

    const videoId = extractTag(entry, 'yt:videoId');
    const title = decodeXmlEntities(extractTag(entry, 'title'));
    const published = extractTag(entry, 'published');
    const updatedRaw = extractTag(entry, 'updated');

    // Extract media:group info
    const descriptionMatch = entry.match(/<media:description>([\s\S]*?)<\/media:description>/);
    const description = descriptionMatch ? decodeXmlEntities(descriptionMatch[1]).substring(0, 150) : '';

    // Extract thumbnail
    const thumbMatch = entry.match(/<media:thumbnail\s+url="([^"]+)"/);
    const thumbnail = thumbMatch ? thumbMatch[1] : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    // Extract view count from media:community/media:statistics
    const viewsMatch = entry.match(/<media:statistics\s+views="(\d+)"/);
    const views = viewsMatch ? formatViews(parseInt(viewsMatch[1])) : '';

    if (videoId && title) {
      videos.push({
        videoId,
        title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail,
        publishedTime: formatDate(published),
        publishedRaw: published,
        views,
        description,
      });
    }
  }

  return videos;
}

function extractTag(xml, tagName) {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`);
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  try {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'اليوم';
    if (diffDays === 1) return 'أمس';
    if (diffDays < 7) return `منذ ${diffDays} أيام`;
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return weeks === 1 ? 'منذ أسبوع' : `منذ ${weeks} أسابيع`;
    }
    if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return months === 1 ? 'منذ شهر' : `منذ ${months} أشهر`;
    }
    const years = Math.floor(diffDays / 365);
    return years === 1 ? 'منذ سنة' : `منذ ${years} سنوات`;
  } catch {
    return '';
  }
}

function formatViews(count) {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}
