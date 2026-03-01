import { list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireAdminEdge } from "@/lib/admin-edge";

export const runtime = "edge";

export async function GET(request: Request): Promise<Response> {
  const session = await requireAdminEdge(request);
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const prefix = searchParams.get("prefix");
  if (!prefix) {
    return NextResponse.json({ error: "prefix is required" }, { status: 400 });
  }

  try {
    // Search by directory prefix (strip the filename) to handle random suffixes.
    const dirPrefix = prefix.includes("/")
      ? prefix.substring(0, prefix.lastIndexOf("/") + 1)
      : prefix;

    const { blobs } = await list({ prefix: dirPrefix, limit: 20 });

    // Try exact match first, then partial match on the original prefix.
    const exact = blobs.find((b) => b.pathname === prefix);
    if (exact) {
      return NextResponse.json({ url: exact.url });
    }

    const partial = blobs.find((b) => b.pathname.startsWith(prefix.replace(/\.pdf$/i, "")));
    if (partial) {
      return NextResponse.json({ url: partial.url });
    }

    if (blobs.length > 0) {
      // Return the first blob in the directory as a fallback.
      return NextResponse.json({ url: blobs[0].url, note: "fallback match", found: blobs.map((b) => b.pathname) });
    }

    // List all admin-staging blobs for debugging.
    const { blobs: allAdmin } = await list({ prefix: "admin-staging/", limit: 10 });
    return NextResponse.json(
      {
        error: "Blob not found",
        searched: dirPrefix,
        allAdminBlobs: allAdmin.map((b) => b.pathname),
      },
      { status: 404 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
