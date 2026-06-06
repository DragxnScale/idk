/**
 * /api/ai/videos
 *
 * Two-stage pipeline:
 *   1. AI reads the session text and produces a list of "topics" — the major
 *      ideas the chapter actually covers (e.g. for Zumdahl Ch. 5: ideal gas
 *      law, Dalton's law, kinetic-molecular theory, real gases / van der
 *      Waals, …) plus a recommended channel for each.
 *   2. For every topic we hit the YouTube Data API to resolve a real video
 *      URL on that channel. If `YOUTUBE_API_KEY` is unset or quota is
 *      exhausted we degrade to a channel-scoped YouTube search URL so the
 *      feature still works.
 *
 * The route returns up to ~12 videos so the client can paginate (5 per page,
 * "Show more" → next page) until every important subject is covered.
 *
 * Channel preferences (recommended, not strict):
 *   - Chemistry → The Organic Chemistry Tutor (top), Professor Dave Explains
 *   - Biology   → Amoeba Sisters, Bozeman Science
 *   - Physics   → Professor Leonard, The Organic Chemistry Tutor
 *   - Math      → 3Blue1Brown, Professor Leonard, The Organic Chemistry Tutor
 *   - Anything  → Khan Academy, CrashCourse, MIT OCW
 */
import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { isAiConfigured, wrapUntrusted, UNTRUSTED_INPUT_GUARD } from "@/lib/ai";
import { aiGenerateOptions, resolveAiLanguageModel } from "@/lib/ai-model-config";
import { buildAiSystemPrompt } from "@/lib/app-settings";
import { db } from "@/lib/db";
import { studySessions } from "@/lib/db/schema";
import { assertAiBudget, recordAiUsage } from "@/lib/ai-usage";
import { searchTopVideoCandidates, youtubeSearchUrl } from "@/lib/youtube";

/** Allow up to 60s — YouTube API + topic generation. */
export const maxDuration = 60;

/** Stored / returned shape — one resolved video. */
export interface VideoRec {
  topic: string;
  title: string;
  channel: string;
  videoUrl: string;
  videoId: string | null;
  thumbnailUrl: string | null;
  reason: string;
  /** True if this is a real Data-API hit, false if we fell back to a search URL. */
  resolved: boolean;
}

const topicsSchema = z.object({
  topics: z
    .array(
      z.object({
        topic: z
          .string()
          .describe(
            "Specific concept/topic that's a major piece of the reading (e.g. 'Ideal Gas Law', 'Kinetic Molecular Theory of Gases', 'Van der Waals Equation')."
          ),
        channelHint: z
          .string()
          .describe(
            "Single channel name to scope the YouTube search — pick the best educator for THIS subject from the recommended list in the system prompt."
          ),
        searchQuery: z
          .string()
          .describe(
            "Tight YouTube search query the channel itself would title a video with (e.g. 'ideal gas law', 'kinetic molecular theory of gases')."
          ),
        reason: z
          .string()
          .describe(
            "One short sentence explaining why this topic matters for the reading."
          ),
      })
    )
    .min(8)
    .max(15),
});

export async function GET(request: Request) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const row = await db.query.studySessions.findFirst({
    where: (s, { and, eq }) =>
      and(eq(s.id, sessionId), eq(s.userId, user.id)),
  });

  if (!row) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (row.videosJson) {
    return NextResponse.json({ videos: JSON.parse(row.videosJson), cached: true });
  }

  return NextResponse.json({ videos: null, cached: false });
}

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI not configured. Add OPENAI_API_KEY to your environment." },
      { status: 503 }
    );
  }

  const overBudget = await assertAiBudget(user.id);
  if (overBudget) return overBudget;

  const { sessionId, accumulatedText, refresh } = (await request.json()) as {
    sessionId: string;
    accumulatedText: string;
    refresh?: boolean;
  };

  if (!sessionId || !accumulatedText) {
    return NextResponse.json(
      { error: "sessionId and accumulatedText are required" },
      { status: 400 }
    );
  }

  const row = await db.query.studySessions.findFirst({
    where: (s, { and, eq }) =>
      and(eq(s.id, sessionId), eq(s.userId, user.id)),
  });
  if (!row) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Re-use cached recommendations unless the client asked to refresh.
  if (!refresh && row.videosJson) {
    return NextResponse.json({ videos: JSON.parse(row.videosJson), cached: true });
  }

  // ── 1. Generate topics ────────────────────────────────────────────
  const baseTopicSystem = `You help a student decide which YouTube videos to watch alongside a textbook chapter.

Given the reading material, identify the chapter's MAJOR conceptual topics — the things a teacher would put on the unit's outline, not narrow side examples. For a chemistry "gases" chapter that means topics like Ideal Gas Law, Dalton's Law of Partial Pressures, Boyle's / Charles's / Avogadro's Laws, Kinetic Molecular Theory of Gases, Real Gases and the Van der Waals Equation, Effusion / Graham's Law, Gas Stoichiometry — each topic is its own video.

For each topic pick ONE channel from the preferred list below. Use the channel that best matches the subject. The channelHint must be the channel's exact display name so a YouTube search ranks their video first.

Preferred channels by subject:
- Chemistry → "The Organic Chemistry Tutor" (preferred), then "Professor Dave Explains"
- Biology → "Amoeba Sisters" (preferred), then "Bozeman Science"
- Physics → "The Organic Chemistry Tutor", then "Professor Leonard"
- Math / calculus → "Professor Leonard", then "3Blue1Brown", then "The Organic Chemistry Tutor"
- Anything else → "Khan Academy", then "CrashCourse"

Rules:
- 8–15 distinct topics, ordered from most foundational to most specialised.
- Topics must be DIFFERENT — never two videos on the same equation or theorem.
- Topics must be the chapter's actual content, not generic study tips.
- searchQuery should match how the channel would title their own video — terse, no "tutorial" / "explained" filler unless the channel uses it.
- reason is ONE sentence explaining why this topic is important for the reading.`;

  let topics;
  try {
    const videosPrompt = `Pick the major topics for this reading.\n\n${wrapUntrusted(
      "reading material",
      accumulatedText.slice(0, 12_000)
    )}`;
    const aiModel = await resolveAiLanguageModel();
    const { object, usage } = await generateObject({
      ...aiGenerateOptions(aiModel),
      schema: topicsSchema,
      system: await buildAiSystemPrompt(baseTopicSystem, "videos"),
      prompt: videosPrompt,
    });
    await recordAiUsage(user.id, "/api/ai/videos", usage, {
      model: aiModel.modelId,
      inputText: videosPrompt,
      outputText: JSON.stringify(object, null, 2),
    });
    topics = object.topics;
  } catch (e) {
    console.error("[ai/videos] topic generation failed:", e);
    return NextResponse.json(
      { error: (e as Error).message || "Topic generation failed" },
      { status: 500 }
    );
  }

  // ── 2. Resolve each topic to a real YouTube video ─────────────────
  // Run searches in parallel (fast) but request multiple candidates per
  // topic so we can dedup afterward. Two AI-generated topics will sometimes
  // resolve to the same top hit (e.g. "manometer pressure" and "barometer
  // intro" → same Organic Chem Tutor video). When that happens, walk the
  // candidate list for the second topic to find an alternate.
  const candidates = await Promise.all(
    topics.map((t) =>
      searchTopVideoCandidates(t.searchQuery, {
        channelHint: t.channelHint,
        safeSearch: "strict",
        maxResults: 5,
      })
    )
  );

  const usedVideoIds = new Set<string>();
  const usedFallbackUrls = new Set<string>();
  const videos: VideoRec[] = topics.map((t, i): VideoRec => {
    const hits = candidates[i] ?? [];
    const fresh = hits.find((h) => !usedVideoIds.has(h.videoId));
    if (fresh) {
      usedVideoIds.add(fresh.videoId);
      return {
        topic: t.topic,
        title: fresh.title,
        channel: fresh.channel,
        videoUrl: fresh.videoUrl,
        videoId: fresh.videoId,
        thumbnailUrl: fresh.thumbnailUrl,
        reason: t.reason,
        resolved: true,
      };
    }

    // YouTube API not configured / quota exhausted / no hit / every
    // candidate was already claimed — fall back to a channel-scoped search
    // URL. Dedup the fallbacks too so identical topic+channel combos can't
    // produce the same link twice.
    const fallbackUrl = youtubeSearchUrl(t.searchQuery, t.channelHint);
    if (usedFallbackUrls.has(fallbackUrl)) {
      // Soft-skip duplicates by appending the topic name to make the URL
      // unique without losing the search semantics. (Worst case: top result
      // shifts slightly — still a real, useful link.)
      const alt = youtubeSearchUrl(`${t.searchQuery} ${t.topic}`, t.channelHint);
      usedFallbackUrls.add(alt);
      return {
        topic: t.topic,
        title: t.topic,
        channel: t.channelHint,
        videoUrl: alt,
        videoId: null,
        thumbnailUrl: null,
        reason: t.reason,
        resolved: false,
      };
    }
    usedFallbackUrls.add(fallbackUrl);
    return {
      topic: t.topic,
      title: t.topic,
      channel: t.channelHint,
      videoUrl: fallbackUrl,
      videoId: null,
      thumbnailUrl: null,
      reason: t.reason,
      resolved: false,
    };
  });

  await db
    .update(studySessions)
    .set({ videosJson: JSON.stringify(videos) })
    .where(eq(studySessions.id, sessionId));

  return NextResponse.json({ videos, cached: false });
}
