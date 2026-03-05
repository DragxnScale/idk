import { list, del } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const allBlobs: {
      url: string;
      pathname: string;
      size: number;
      uploadedAt: string;
    }[] = [];

    let cursor: string | undefined;
    do {
      const res = await list({ cursor, limit: 100 });
      for (const b of res.blobs) {
        allBlobs.push({
          url: b.url,
          pathname: b.pathname,
          size: b.size,
          uploadedAt: b.uploadedAt.toISOString(),
        });
      }
      cursor = res.hasMore ? res.cursor : undefined;
    } while (cursor);

    const totalSize = allBlobs.reduce((s, b) => s + b.size, 0);

    return NextResponse.json({ blobs: allBlobs, totalSize });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url param required" }, { status: 400 });
  }

  try {
    await del(url);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
