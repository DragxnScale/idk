import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId, action, durationMinutes } = await req.json();
  if (!userId || !action) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  switch (action) {
    case "mute": {
      const mins = durationMinutes ?? 60;
      const until = new Date(Date.now() + mins * 60_000);
      await db.update(users).set({ mutedUntil: until }).where(eq(users.id, userId));
      return NextResponse.json({ ok: true, mutedUntil: until.toISOString() });
    }
    case "unmute":
      await db.update(users).set({ mutedUntil: null }).where(eq(users.id, userId));
      return NextResponse.json({ ok: true });
    case "block":
      await db.update(users).set({ blocked: true }).where(eq(users.id, userId));
      return NextResponse.json({ ok: true });
    case "unblock":
      await db.update(users).set({ blocked: false }).where(eq(users.id, userId));
      return NextResponse.json({ ok: true });
    default:
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
}
