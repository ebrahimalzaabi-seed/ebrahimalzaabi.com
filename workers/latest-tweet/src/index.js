const HANDLE = "ebrahimuae1";
const BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// GraphQL features required by UserByScreenName
const USER_FEATURES = {
  hidden_profile_likes_enabled: true,
  hidden_profile_subscriptions_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      const data = await fetchPinnedTweet();
      return new Response(JSON.stringify(data, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
          ...CORS_HEADERS,
        },
      });
    } catch (err) {
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

// Step 1: Get a guest token from Twitter
async function getGuestToken() {
  const res = await fetch("https://api.twitter.com/1.1/guest/activate.json", {
    method: "POST",
    headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Guest token request failed: ${res.status}`);
  const json = await res.json();
  return json.guest_token;
}

// Step 2: Look up the user profile to get the pinned tweet ID
async function getUserProfile(guestToken) {
  const variables = JSON.stringify({
    screen_name: HANDLE,
    withSafetyModeUserFields: true,
  });
  const features = JSON.stringify(USER_FEATURES);
  const url =
    `https://twitter.com/i/api/graphql/G3KGOASz96M-Qu0nwmGXNg/UserByScreenName` +
    `?variables=${encodeURIComponent(variables)}` +
    `&features=${encodeURIComponent(features)}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${BEARER_TOKEN}`,
      "x-guest-token": guestToken,
    },
  });
  if (!res.ok) throw new Error(`UserByScreenName failed: ${res.status}`);
  return res.json();
}

// Step 3: Fetch tweet details via the syndication CDN (no auth needed)
async function getTweetDetail(tweetId) {
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=0`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: "https://platform.twitter.com/",
    },
  });
  if (!res.ok) throw new Error(`Tweet detail fetch failed: ${res.status}`);
  return res.json();
}

// Orchestrator
async function fetchPinnedTweet() {
  const guestToken = await getGuestToken();
  const profileData = await getUserProfile(guestToken);

  const user = profileData?.data?.user?.result;
  if (!user) throw new Error("User not found");

  const legacy = user.legacy;
  const pinnedIds = legacy?.pinned_tweet_ids_str || [];

  if (pinnedIds.length === 0) {
    throw new Error("No pinned tweet found for this user");
  }

  const tweetId = pinnedIds[0];
  const tweet = await getTweetDetail(tweetId);

  if (!tweet || !tweet.text) {
    throw new Error("Could not fetch tweet detail");
  }

  // Get the higher-res profile image (replace _normal with _400x400)
  const profileImg = (
    tweet.user?.profile_image_url_https ||
    legacy?.profile_image_url_https ||
    ""
  ).replace("_normal.", "_400x400.");

  return {
    profile: {
      name: tweet.user?.name || legacy?.name || HANDLE,
      handle: `@${tweet.user?.screen_name || legacy?.screen_name || HANDLE}`,
      imageUrl: profileImg,
    },
    tweet: {
      id: tweet.id_str || tweetId,
      text: tweet.text,
      url: `https://x.com/${HANDLE}/status/${tweet.id_str || tweetId}`,
      datetime: tweet.created_at || "",
    },
  };
}
