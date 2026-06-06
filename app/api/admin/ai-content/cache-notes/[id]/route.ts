import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { documentNotes, publicNotes } from "@/lib/db/schema";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Params) {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind") ?? "public";

    if (kind === "document") {
      const row = await db.query.documentNotes.findFirst({
        where: eq(documentNotes.id, id),
      });
      if (!row) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      await db.delete(documentNotes).where(eq(documentNotes.id, id));
      return NextResponse.json({ ok: true });
    }

    const row = await db.query.publicNotes.findFirst({
      where: eq(publicNotes.id, id),
    });
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await db.delete(publicNotes).where(eq(publicNotes.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/ai-content/cache-notes]", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
