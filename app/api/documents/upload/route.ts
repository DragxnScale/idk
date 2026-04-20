import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const title = (formData.get("title") as string) || "Untitled";

  if (!file || file.type !== "application/pdf") {
    return NextResponse.json({ error: "A PDF file is required" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const filename = `${user.id}/${id}.pdf`;

  const blob = await put(filename, file, { access: "public", contentType: "application/pdf" });

  const now = new Date();
  await db.insert(documents).values({
    id,
    userId: user.id,
    title,
    sourceType: "upload",
    fileUrl: blob.url,
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({ id, title, fileUrl: blob.url });
}
