import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireAdmin } from "@/lib/admin";

export const maxDuration = 120;

async function resolveArchiveUrl(url: string): Promise<string> {
  const detailsMatch = url.match(/archive\.org\/details\/([^/?#]+)/);
  if (!detailsMatch) return url;

  const identifier = detailsMatch[1];
  try {
    const metaRes = await fetch(
      `https://archive.org/metadata/${identifier}/files`,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; BowlBeacon/1.0)" } }
    );
    if (!metaRes.ok) return url;
    const meta = await metaRes.json();
    const pdfFile = (meta.result ?? []).find(
      (f: { name: string }) => f.name.toLowerCase().endsWith(".pdf")
    );
    if (pdfFile) {
      return `https://archive.org/download/${identifier}/${encodeURIComponent(pdfFile.name)}`;
    }
  } catch { /* fall through */ }
  return url;
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
  }

  const { url: rawUrl, identifier } = await request.json();
  if (!rawUrl || typeof rawUrl !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const url = await resolveArchiveUrl(rawUrl);

  let fetchRes: Response;
  try {
    fetchRes = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BowlBeacon/1.0)" },
      redirect: "follow",
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach that URL. Check the link and try again." },
      { status: 400 }
    );
  }

  if (!fetchRes.ok) {
    return NextResponse.json(
      { error: `The URL returned ${fetchRes.status}. Make sure it's publicly accessible.` },
      { status: 400 }
    );
  }

  const filename = decodeURIComponent(url.split("/").pop() ?? "document.pdf");
  const pathname = `public/${identifier || "archive"}/${filename}`;

  try {
    const blob = await put(pathname, fetchRes.body!, {
      access: "public",
      contentType: "application/pdf",
    });
    return NextResponse.json({ blobUrl: blob.url, pathname: blob.pathname });
  } catch (e) {
    console.error("[admin/download-store] error:", e);
    return NextResponse.json(
      { error: (e as Error).message || "Upload to storage failed" },
      { status: 500 }
    );
  }
}
