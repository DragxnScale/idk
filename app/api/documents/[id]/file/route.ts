import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const doc = await db.query.documents.findFirst({
    where: (d, { eq, and }) =>
      and(eq(d.id, params.id), eq(d.userId, user.id)),
  });

  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (!doc.fileUrl) {
    return NextResponse.json({ error: "No file stored for this document" }, { status: 404 });
  }

  // Redirect to the Vercel Blob public URL
  return NextResponse.redirect(doc.fileUrl);
}
