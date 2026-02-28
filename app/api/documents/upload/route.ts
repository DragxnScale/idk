import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { auth } from "@/lib/auth";
import { store } from "@/lib/store";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const title = (formData.get("title") as string) || "Untitled";

  if (!file || file.type !== "application/pdf") {
    return NextResponse.json(
      { error: "A PDF file is required" },
      { status: 400 }
    );
  }

  const id = crypto.randomUUID();
  const filename = `${id}.pdf`;
  const uploadsDir = path.join(process.cwd(), "uploads");
  await mkdir(uploadsDir, { recursive: true });
  const filePath = path.join(uploadsDir, filename);

  const bytes = await file.arrayBuffer();
  await writeFile(filePath, Buffer.from(bytes));

  const now = new Date().toISOString();
  store.createDocument({
    id,
    userId: session.user.id,
    title,
    sourceType: "upload",
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({ id, title, filename });
}
