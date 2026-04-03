const HANDLE = "ebrahimuae1";
const NITTER_BASE = "https://nitter.net";
const NITTER_RSS_URL = `${NITTER_BASE}/${HANDLE}/rss`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CACHE_KEY = "tweets_v2";
const CACHE_TTL = 3600; // 1 hour in seconds

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const kv = env.TWEET_CACHE;
    const cached = await kv.get(CACHE_KEY, { type: "json" });

    if (cached) {
      console.log("[CACHE HIT] Serving tweets from KV cache");
      return jsonResponse(cached);
    }

    try {
      const data = await fetchTweets();
      console.log("[CACHE MISS] Fetched fresh tweets from Nitter RSS, storing in KV");
      ctx.waitUntil(kv.put(CACHE_KEY, JSON.stringify(data), { expirationTtl: CACHE_TTL }));
      return jsonResponse(data);
    } catch (err) {
      console.error("[ERROR] Tweet fetch failed:", err.message);
      return new Response(
        JSON.stringify({ error: err.message }),
        {
          status: 502,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        }
      );
    }
  },
};

function jsonResponse(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      ...CORS_HEADERS,
    },
  });
}

// Fetch and parse the Nitter RSS feed
async function fetchTweets() {
  const res = await fetch(NITTER_RSS_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; TweetWidget/1.0)",
    },
  });
  if (!res.ok) throw new Error(`Nitter RSS fetch failed: ${res.status}`);

  const xml = await res.text();
  const items = parseRssItems(xml);

  if (items.length === 0) {
    throw new Error("No tweets found in RSS feed");
  }

  // Extract profile info from the RSS channel
  const profile = parseProfile(xml);

  // Find pinned tweet (Nitter marks it with "Pinned:" prefix in the title)
  const pinnedItem = items.find((item) => item.title.startsWith("Pinned:"));
  // Latest tweet is the first non-pinned item
  const latestItem = items.find((item) => !item.title.startsWith("Pinned:"));

  const result = { profile };

  if (latestItem) {
    result.latest = formatTweet(latestItem);
  }
  if (pinnedItem) {
    result.pinned = formatTweet(pinnedItem);
  }

  return result;
}

// Parse RSS <item> elements from the XML string
function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    items.push({
      title: extractTag(block, "title"),
      link: extractTag(block, "link"),
      description: extractTag(block, "description"),
      pubDate: extractTag(block, "pubDate"),
    });
  }
  return items;
}

// Extract profile info from the RSS <channel>
function parseProfile(xml) {
  const channelMatch = xml.match(/<channel>([\s\S]*?)<item>/);
  const channel = channelMatch ? channelMatch[1] : xml;

  const rawTitle = extractTag(channel, "title");
  // Title format: "Name / @handle"
  const namePart = rawTitle.split(" / ")[0] || HANDLE;
  const handlePart = rawTitle.split(" / ")[1] || `@${HANDLE}`;

  // Profile image from RSS <image><url>
  const imageMatch = channel.match(/<image>[\s\S]*?<url>([\s\S]*?)<\/url>[\s\S]*?<\/image>/);
  let imageUrl = imageMatch ? imageMatch[1].trim() : "";
  // Convert Nitter proxy URL to direct Twitter CDN URL with higher res
  if (imageUrl.includes("/pic/")) {
    const encoded = imageUrl.split("/pic/")[1];
    imageUrl = decodeURIComponent(encoded).replace("_normal.", "_400x400.");
  }

  return {
    name: namePart.trim(),
    handle: handlePart.trim(),
    imageUrl,
  };
}

// Format a parsed RSS item into our tweet structure
function formatTweet(item) {
  // Extract tweet ID from nitter link: https://nitter.net/user/status/ID#m
  const idMatch = item.link.match(/\/status\/(\d+)/);
  const tweetId = idMatch ? idMatch[1] : "";

  // Clean HTML from description to get plain text
  let text = item.title || "";
  // Remove "Pinned: " prefix if present
  if (text.startsWith("Pinned:")) {
    text = text.substring(7).trim();
  }

  // A tweet longer than 280 chars is a long-form tweet
  const isLongTweet = text.length > 280;

  return {
    id: tweetId,
    text: text,
    url: `https://x.com/${HANDLE}/status/${tweetId}`,
    datetime: item.pubDate || "",
    isLongTweet,
  };
}

// Strip HTML tags from a string
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

// Extract text content of an XML tag
function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  if (!match) return "";
  return (match[1] || match[2] || "").trim();
}
