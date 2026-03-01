import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireAdminEdge } from "@/lib/admin-edge";

export const runtime = "edge";
export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await requireAdminEdge(request);
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const pathname = searchParams.get("pathname");
  if (!pathname) {
    return NextResponse.json({ error: "pathname is required" }, { status: 400 });
  }

  if (!request.body) {
    return NextResponse.json({ error: "No file body" }, { status: 400 });
  }

  try {
    const blob = await put(pathname, request.body, {
      access: "public",
      contentType: "application/pdf",
      multipart: true,
    });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
