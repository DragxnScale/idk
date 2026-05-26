/**
 * Tiny YouTube Data API v3 client.
 *
 * Used by `/api/ai/videos` to turn AI-generated search queries into real,
 * clickable video URLs scoped to the channels we want to surface (e.g. The
 * Organic Chemistry Tutor for chemistry, Amoeba Sisters for biology).
 *
 * If `YOUTUBE_API_KEY` is missing or the call fails (quota etc.), the caller
 * can fall back to a generic YouTube search URL.
 */

export interface YoutubeVideoHit {
  videoId: string;
  videoUrl: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
  description: string;
}

const SEARCH_ENDPOINT = "https://www.googleapis.com/youtube/v3/search";

/**
 * Search YouTube for a single video matching `query`. Optionally bias the
 * search toward a specific channel name (we append it to the query so the
 * AI's pick is consistent with the requested educator).
 *
 * Returns `null` if the API key is missing, the quota is exhausted, or no
 * results are found. Callers should treat `null` as a soft failure and
 * fall back to a search URL.
 */
export async function searchTopVideo(
  query: string,
  opts: { channelHint?: string; safeSearch?: "moderate" | "strict" } = {}
): Promise<YoutubeVideoHit | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;

  const fullQuery = opts.channelHint
    ? `${query} ${opts.channelHint}`.trim()
    : query;

  const params = new URLSearchParams({
    part: "snippet",
    q: fullQuery,
    type: "video",
    maxResults: "1",
    safeSearch: opts.safeSearch ?? "strict",
    videoEmbeddable: "true",
    key: apiKey,
  });

  let res: Response;
  try {
    res = await fetch(`${SEARCH_ENDPOINT}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    console.warn("[youtube] fetch failed:", (e as Error).message);
    return null;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[youtube] ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
    return null;
  }

  const data = (await res.json()) as {
    items?: Array<{
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        channelTitle?: string;
        description?: string;
        thumbnails?: {
          medium?: { url?: string };
          default?: { url?: string };
        };
      };
    }>;
  };

  const item = data.items?.[0];
  const videoId = item?.id?.videoId;
  if (!videoId) return null;

  const sn = item?.snippet ?? {};
  return {
    videoId,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    title: sn.title ?? "",
    channel: sn.channelTitle ?? "",
    thumbnailUrl:
      sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url ?? "",
    description: sn.description ?? "",
  };
}

/**
 * Plain YouTube search URL we hand back as a fallback when the Data API
 * isn't available. We bias the query toward the channel hint so the top
 * search result is still likely to be the educator the user wanted.
 */
export function youtubeSearchUrl(query: string, channelHint?: string): string {
  const q = channelHint ? `${query} ${channelHint}` : query;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}
