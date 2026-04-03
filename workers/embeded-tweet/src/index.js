const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CACHE_KEY = "tweets_v3";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const kv = env.TWEET_CACHE;
    const data = await kv.get(CACHE_KEY, { type: "json" });

    if (data) {
      return new Response(JSON.stringify(data, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
          ...CORS_HEADERS,
        },
      });
    }

    return new Response(
      JSON.stringify({ error: "No tweet data available. Cache may be warming up." }),
      {
        status: 503,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  },
};
