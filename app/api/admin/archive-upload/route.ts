import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

// Allow up to 5 minutes for large PDF uploads
export const maxDuration = 300;

// Disable Next.js body parsing so we can stream the raw body to archive.org
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

  // Metadata comes in as query params; the raw body is the PDF binary
  const { searchParams } = new URL(request.url);
  const identifier = searchParams.get("identifier");
  const filename = searchParams.get("filename");
  const title = searchParams.get("title") ?? "";
  const edition = searchParams.get("edition") ?? "";
  const isbn = searchParams.get("isbn") ?? "";

  if (!identifier || !filename) {
    return NextResponse.json({ error: "identifier and filename are required" }, { status: 400 });
  }

  const uploadUrl = `https://s3.us.archive.org/${identifier}/${filename}`;

  const headers: Record<string, string> = {
    Authorization: `LOW ${accessKey}:${secretKey}`,
    "x-archive-auto-make-bucket": "1",
    "x-archive-meta-title": title,
    "x-archive-meta-mediatype": "texts",
    "x-archive-meta-subject": "textbook;education;studyfocus",
    "Content-Type": "application/pdf",
  };

  if (edition) headers["x-archive-meta-edition"] = edition;
  if (isbn) headers["x-archive-meta-identifier-isbn"] = isbn;

  const contentLength = request.headers.get("content-length");
  if (contentLength) headers["Content-Length"] = contentLength;

  // Stream the request body directly to archive.org — no buffering
  const archiveRes = await fetch(uploadUrl, {
    method: "PUT",
    headers,
    body: request.body,
    // @ts-expect-error — Node.js fetch requires this for streaming request bodies
    duplex: "half",
  });

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
