import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { auth } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const doc = store.getDocument(params.id, session.user.id);

  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const filePath = path.join(process.cwd(), "uploads", `${doc.id}.pdf`);

  try {
    const buffer = await readFile(filePath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${doc.title ?? "document"}.pdf"`,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "File not found on disk" },
      { status: 404 }
    );
  }
}
