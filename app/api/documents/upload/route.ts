import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { putPdf } from "@/lib/storage-backend";

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

  const buffer = Buffer.from(await file.arrayBuffer());
  const stored = await putPdf(filename, buffer, { contentType: "application/pdf" });

  const now = new Date();
  await db.insert(documents).values({
    id,
    userId: user.id,
    title,
    sourceType: "upload",
    fileUrl: stored.url,
    fileSizeBytes: file.size,
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({ id, title, fileUrl: stored.url });
}
