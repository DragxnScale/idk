import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { openai, MODEL, isAiConfigured } from "@/lib/ai";
import { appendOwnerStyleToSystem, getAiOwnerStyleExtra } from "@/lib/app-settings";
import { db } from "@/lib/db";
import { studySessions } from "@/lib/db/schema";
import { assertAiBudget, recordAiUsage } from "@/lib/ai-usage";

const videoSchema = z.object({
  videos: z.array(
    z.object({
      title: z.string().describe("Short, descriptive title for the video card (e.g. 'Covalent Bonds Explained')"),
      searchQuery: z.string().describe("Specific YouTube search query (e.g. 'covalent bonds chemistry tutorial Khan Academy')"),
      reason: z.string().describe("One sentence explaining why this video helps with what was read"),
    })
  ).min(3).max(5),
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

  const { sessionId, accumulatedText } = await request.json() as {
    sessionId: string;
    accumulatedText: string;
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

  // Return cached result if already generated
  if (row.videosJson) {
    return NextResponse.json({ videos: JSON.parse(row.videosJson), cached: true });
  }

  const ownerExtra = await getAiOwnerStyleExtra();
  const baseVideoSystem = `You are a study assistant. Given reading material from a textbook session, 
suggest 3-5 YouTube videos that would genuinely help the student understand the topics better.

Rules:
- Search queries must be highly specific — include subject area, concept name, and "explained" or "tutorial"
- Prefer channels like Khan Academy, Professor Leonard, 3Blue1Brown, Crash Course, MIT OCW for academic topics
- Each video should cover a DIFFERENT concept from the reading — don't repeat topics
- The reason should be one crisp sentence explaining exactly what gap this video fills`;

  const { object, usage } = await generateObject({
    model: openai(MODEL),
    schema: videoSchema,
    system: appendOwnerStyleToSystem(baseVideoSystem, ownerExtra),
    prompt: `Study session reading material (excerpt):\n\n${accumulatedText.slice(0, 8000)}`,
  });
  await recordAiUsage(user.id, "/api/ai/videos", usage);

  await db
    .update(studySessions)
    .set({ videosJson: JSON.stringify(object.videos) })
    .where(eq(studySessions.id, sessionId));

  return NextResponse.json({ videos: object.videos, cached: false });
}
