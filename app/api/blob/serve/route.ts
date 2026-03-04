import { head } from "@vercel/blob";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const maxDuration = 120;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url || !url.includes("blob.vercel-storage.com")) {
    return NextResponse.json({ error: "Invalid blob URL" }, { status: 400 });
  }

  try {
    const blob = await head(url);
    const pdfRes = await fetch(blob.downloadUrl);
    if (!pdfRes.ok) {
      return NextResponse.json({ error: `Blob CDN returned ${pdfRes.status}` }, { status: 502 });
    }

    return new Response(pdfRes.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": pdfRes.headers.get("Content-Length") || "",
        "Cache-Control": "private, max-age=3600",
        "Accept-Ranges": "bytes",
      },
    });
  } catch (e) {
    console.error("[blob/serve] error:", e);
    return NextResponse.json(
      { error: (e as Error).message || "Failed to serve file" },
      { status: 500 }
    );
  }
}
