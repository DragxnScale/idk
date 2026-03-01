import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const title = (formData.get("title") as string) || "Untitled";

  if (!file || file.type !== "application/pdf") {
    return NextResponse.json({ error: "A PDF file is required" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const filename = `${session.user.id}/${id}.pdf`;

  const blob = await put(filename, file, { access: "public" });

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

  return NextResponse.json({ id, title, fileUrl: blob.url });
}
