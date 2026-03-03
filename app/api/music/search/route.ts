import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import ytsr from "ytsr";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ error: "Query too short" }, { status: 400 });
  }

  try {
    const res = await ytsr(q, { limit: 8 });
    const videos = res.items
      .filter((item): item is ytsr.Video => item.type === "video")
      .slice(0, 6)
      .map((v) => ({
        id: v.id,
        title: v.title,
        url: v.url,
        duration: v.duration ?? null,
        thumbnail: v.bestThumbnail?.url ?? null,
      }));

    return NextResponse.json({ results: videos });
  } catch (e) {
    return NextResponse.json(
      { error: "Search failed", detail: (e as Error).message },
      { status: 500 }
    );
  }
}
