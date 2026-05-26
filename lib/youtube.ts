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
 * Search YouTube for up to `maxResults` videos matching `query`. Optionally
 * bias the search toward a specific channel name (we append it to the query
 * so the AI's pick is consistent with the requested educator).
 *
 * Returns an empty array if the API key is missing, the quota is exhausted,
 * or no results are found. Callers should treat `[]` as a soft failure and
 * fall back to a search URL.
 *
 * Multiple results are returned so the caller can dedup across topics — when
 * two AI-generated topics resolve to the same top hit, the second topic can
 * fall through to the next candidate instead of duplicating the first.
 */
export async function searchTopVideoCandidates(
  query: string,
  opts: {
    channelHint?: string;
    safeSearch?: "moderate" | "strict";
    maxResults?: number;
  } = {}
): Promise<YoutubeVideoHit[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  const fullQuery = opts.channelHint
    ? `${query} ${opts.channelHint}`.trim()
    : query;

  const params = new URLSearchParams({
    part: "snippet",
    q: fullQuery,
    type: "video",
    maxResults: String(Math.max(1, Math.min(10, opts.maxResults ?? 5))),
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
    return [];
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[youtube] ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
    return [];
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

  const hits: YoutubeVideoHit[] = [];
  for (const item of data.items ?? []) {
    const videoId = item?.id?.videoId;
    if (!videoId) continue;
    const sn = item?.snippet ?? {};
    hits.push({
      videoId,
      videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
      title: sn.title ?? "",
      channel: sn.channelTitle ?? "",
      thumbnailUrl:
        sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url ?? "",
      description: sn.description ?? "",
    });
  }
  return hits;
}

/**
 * Convenience wrapper that returns just the top hit (or `null`). Kept as a
 * separate export so callers that don't need dedup don't have to slice.
 */
export async function searchTopVideo(
  query: string,
  opts: { channelHint?: string; safeSearch?: "moderate" | "strict" } = {}
): Promise<YoutubeVideoHit | null> {
  const hits = await searchTopVideoCandidates(query, { ...opts, maxResults: 1 });
  return hits[0] ?? null;
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
