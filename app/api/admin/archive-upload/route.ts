import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { requireAdmin } from "@/lib/admin";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const accessKey = process.env.ARCHIVE_ACCESS_KEY;
  const secretKey = process.env.ARCHIVE_SECRET_KEY;

  if (!accessKey || !secretKey) {
    return NextResponse.json(
      { error: "Archive.org credentials not configured on the server." },
      { status: 503 }
    );
  }

  // File is already in Vercel Blob — receive just the metadata as JSON (tiny body)
  const { blobUrl, identifier, filename, title, edition, isbn } = await request.json();

  if (!blobUrl || !identifier || !filename) {
    return NextResponse.json({ error: "blobUrl, identifier and filename are required" }, { status: 400 });
  }

  // Fetch the PDF from Vercel Blob and stream it to archive.org server-to-server
  // No CORS issues, no client body size limit
  const blobRes = await fetch(blobUrl);
  if (!blobRes.ok) {
    return NextResponse.json({ error: "Could not read file from Blob storage." }, { status: 502 });
  }

  const uploadUrl = `https://s3.us.archive.org/${identifier}/${filename}`;

  const headers: Record<string, string> = {
    Authorization: `LOW ${accessKey}:${secretKey}`,
    "x-archive-auto-make-bucket": "1",
    "x-archive-meta-title": title ?? "",
    "x-archive-meta-mediatype": "texts",
    "x-archive-meta-subject": "textbook;education;bowlbeacon",
    "Content-Type": "application/pdf",
  };

  if (edition) headers["x-archive-meta-edition"] = edition;
  if (isbn) headers["x-archive-meta-identifier-isbn"] = isbn;

  const contentLength = blobRes.headers.get("content-length");
  if (contentLength) headers["Content-Length"] = contentLength;

  const archiveRes = await fetch(uploadUrl, {
    method: "PUT",
    headers,
    body: blobRes.body,
    // @ts-expect-error — Node.js fetch requires this for streaming request bodies
    duplex: "half",
  });

  // Clean up the temporary blob regardless of outcome
  await del(blobUrl).catch(() => {});

  if (!archiveRes.ok) {
    const text = await archiveRes.text().catch(() => "");
    return NextResponse.json(
      { error: `Archive.org returned ${archiveRes.status}${text ? `: ${text.slice(0, 200)}` : ""}` },
      { status: 502 }
    );
  }

  const publicUrl = `https://archive.org/download/${identifier}/${filename}`;
  return NextResponse.json({ ok: true, url: publicUrl });
}
