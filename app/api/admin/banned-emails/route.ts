import { NextResponse } from "next/server";
import { requireAdmin, isSuperAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { bannedEmails } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const list = await db.query.bannedEmails.findMany();
  return NextResponse.json(
    list.map((b) => ({
      email: b.email,
      reason: b.reason,
      bannedBy: b.bannedBy,
      bannedAt: b.bannedAt?.toISOString() ?? null,
    }))
  );
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email, reason } = await request.json();
  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  const normalized = (email as string).toLowerCase().trim();
  if (isSuperAdmin(normalized)) {
    return NextResponse.json({ error: "Cannot ban the owner" }, { status: 400 });
  }

  await db.insert(bannedEmails).values({
    email: normalized,
    reason: reason || null,
    bannedBy: session.user?.email ?? "unknown",
    bannedAt: new Date(),
  }).onConflictDoNothing();

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email")?.toLowerCase().trim();
  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  await db.delete(bannedEmails).where(eq(bannedEmails.email, email));
  return NextResponse.json({ ok: true });
}
