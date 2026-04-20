import { NextRequest, NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";

interface InnerTubeVideo {
  videoRenderer?: {
    videoId: string;
    title?: { runs?: { text: string }[] };
    lengthText?: { simpleText?: string };
    thumbnail?: { thumbnails?: { url: string }[] };
  };
}

export async function GET(req: NextRequest) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ error: "Query too short" }, { status: 400 });
  }

  try {
    const res = await fetch(
      "https://www.youtube.com/youtubei/v1/search?prettyPrint=false",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: {
            client: { clientName: "WEB", clientVersion: "2.20240101.00.00" },
          },
          query: q,
        }),
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: "YouTube search failed", detail: `Status ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const sections =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
        ?.sectionListRenderer?.contents ?? [];

    const items: InnerTubeVideo[] =
      sections[0]?.itemSectionRenderer?.contents ?? [];

    const videos = items
      .filter((i) => i.videoRenderer?.videoId)
      .slice(0, 6)
      .map((i) => {
        const v = i.videoRenderer!;
        return {
          id: v.videoId,
          title: v.title?.runs?.[0]?.text ?? "Untitled",
          url: `https://www.youtube.com/watch?v=${v.videoId}`,
          duration: v.lengthText?.simpleText ?? null,
          thumbnail: v.thumbnail?.thumbnails?.[0]?.url ?? null,
        };
      });

    return NextResponse.json({ results: videos });
  } catch (e) {
    return NextResponse.json(
      { error: "Search failed", detail: (e as Error).message },
      { status: 500 }
    );
  }
}
