import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

// Edge runtime: no 4.5 MB body limit, handles large streaming uploads
export const runtime = "edge";
export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await requireAdmin();
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

  const blob = await put(pathname, request.body, {
    access: "public",
    contentType: "application/pdf",
  });

  return NextResponse.json({ url: blob.url });
}
