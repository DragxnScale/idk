import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

// Called after a client-side Vercel Blob upload completes.
// Registers the document in the DB so it shows up in My Drive.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { title, fileUrl } = await request.json();
  if (!fileUrl) {
    return NextResponse.json({ error: "fileUrl required" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(documents).values({
    id,
    userId: session.user.id,
    title: title || "Untitled",
    sourceType: "upload",
    fileUrl,
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({ id, title: title || "Untitled", fileUrl });
}
