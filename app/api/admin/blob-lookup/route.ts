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
    const { blobs } = await list({ prefix, limit: 1 });
    if (blobs.length === 0) {
      return NextResponse.json({ error: "Blob not found" }, { status: 404 });
    }
    return NextResponse.json({ url: blobs[0].url });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
