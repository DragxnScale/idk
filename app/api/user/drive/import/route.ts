import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { unzipSync } from "fflate";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

export const maxDuration = 120;

const ZIP_MAX_BYTES = 500 * 1024 * 1024;

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

interface ImportedDoc {
  id: string;
  title: string;
  fileUrl: string;
}

function titleFromUrl(url: string, filename?: string): string {
  const raw = (filename ?? url.split("/").pop() ?? "Document")
    .replace(/\.pdf$/i, "")
    .replace(/\.zip$/i, "");
  return decodeURIComponent(raw).replace(/[-_]/g, " ").trim() || "Document";
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  let url: string = (body.url ?? "").trim();
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  url = await resolveArchiveUrl(url);

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

  const contentType = fetchRes.headers.get("content-type") ?? "";
  const lowerUrl = url.toLowerCase();

  const looksLikeZip = contentType.includes("zip") || lowerUrl.endsWith(".zip");
  const isOctetStream = contentType.includes("octet-stream");
  const looksLikePdf =
    contentType.includes("pdf") ||
    lowerUrl.endsWith(".pdf") ||
    (isOctetStream && lowerUrl.includes("archive.org/"));

  // ── Direct PDF: stream response body straight to Vercel Blob ──────────
  // No buffering — the file never sits in server memory.
  if (looksLikePdf && !looksLikeZip) {
    const id = crypto.randomUUID();
    const title = titleFromUrl(url);
    const filename = `${session.user.id}/${id}.pdf`;

    const blob = await put(filename, fetchRes.body!, {
      access: "public",
      contentType: "application/pdf",
    });

    const now = new Date();
    await db.insert(documents).values({
      id,
      userId: session.user.id,
      title,
      sourceType: "upload",
      fileUrl: blob.url,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ imported: [{ id, title, fileUrl: blob.url }] });
  }

  // ── ZIP: buffer, check size, unzip, upload each PDF ───────────────────
  if (looksLikeZip) {
    const contentLength = Number(fetchRes.headers.get("content-length") ?? 0);
    if (contentLength > ZIP_MAX_BYTES) {
      return NextResponse.json(
        { error: `ZIP file is too large (${Math.round(contentLength / 1024 / 1024)} MB). Max is 200 MB.` },
        { status: 400 }
      );
    }

    const rawBytes = new Uint8Array(await fetchRes.arrayBuffer());

    // Double-check magic bytes in case Content-Type was wrong
    const isPdfMagic = rawBytes[0] === 0x25 && rawBytes[1] === 0x50 && rawBytes[2] === 0x44 && rawBytes[3] === 0x46;
    if (isPdfMagic) {
      // Server said zip but it's actually a PDF — stream to blob
      const id = crypto.randomUUID();
      const title = titleFromUrl(url);
      const blob = await put(`${session.user.id}/${id}.pdf`, Buffer.from(rawBytes), {
        access: "public",
        contentType: "application/pdf",
      });
      const now = new Date();
      await db.insert(documents).values({
        id, userId: session.user.id, title, sourceType: "upload",
        fileUrl: blob.url, createdAt: now, updatedAt: now,
      });
      return NextResponse.json({ imported: [{ id, title, fileUrl: blob.url }] });
    }

    let unzipped: ReturnType<typeof unzipSync>;
    try {
      unzipped = unzipSync(rawBytes);
    } catch {
      return NextResponse.json(
        { error: "Could not unzip the file. It may be corrupted or password-protected." },
        { status: 400 }
      );
    }

    const pdfEntries = Object.entries(unzipped).filter(
      ([name]) => name.toLowerCase().endsWith(".pdf") && !name.startsWith("__MACOSX")
    );

    if (pdfEntries.length === 0) {
      return NextResponse.json({ error: "The zip file contains no PDF files." }, { status: 400 });
    }

    const imported: ImportedDoc[] = [];
    const now = new Date();

    for (const [name, bytes] of pdfEntries) {
      const id = crypto.randomUUID();
      const title = titleFromUrl(url, name.split("/").pop());
      const blob = await put(`${session.user.id}/${id}.pdf`, Buffer.from(bytes), {
        access: "public",
        contentType: "application/pdf",
      });
      await db.insert(documents).values({
        id, userId: session.user.id, title, sourceType: "upload",
        fileUrl: blob.url, createdAt: now, updatedAt: now,
      });
      imported.push({ id, title, fileUrl: blob.url });
    }

    return NextResponse.json({ imported });
  }

  // ── Unknown type: peek at magic bytes ─────────────────────────────────
  // We've already consumed the body above if zip; this path only runs for
  // content that is neither clearly PDF nor ZIP by URL/Content-Type.
  return NextResponse.json(
    { error: "The link doesn't appear to be a PDF or ZIP file. Make sure it ends in .pdf or .zip." },
    { status: 400 }
  );
}
