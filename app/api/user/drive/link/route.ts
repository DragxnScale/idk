import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { url, title } = await request.json();
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const cleanUrl = url.trim();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(cleanUrl);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return NextResponse.json({ error: "URL must be http or https" }, { status: 400 });
  }

  const autoTitle =
    title ||
    decodeURIComponent(cleanUrl.split("/").pop() ?? "Document")
      .replace(/\.pdf$/i, "")
      .replace(/[-_]/g, " ")
      .trim() ||
    "Linked Document";

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(documents).values({
    id,
    userId: session.user.id,
    title: autoTitle,
    sourceType: "upload",
    fileUrl: cleanUrl,
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({ id, title: autoTitle, fileUrl: cleanUrl });
}
