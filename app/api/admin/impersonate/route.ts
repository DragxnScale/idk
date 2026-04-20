import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { VIEW_AS_COOKIE } from "@/lib/app-user";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/**
 * POST { userId: string | null }
 * Sets or clears view-as-user cookie for admins only.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email || !(await isAdmin(session.user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { userId?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const targetId = body.userId ?? null;

  if (!targetId || targetId === session.user.id) {
    const res = NextResponse.json({ ok: true, cleared: true });
    res.cookies.delete(VIEW_AS_COOKIE);
    return res;
  }

  const exists = await db.query.users.findFirst({
    where: eq(users.id, targetId),
    columns: { id: true },
  });

  if (!exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const res = NextResponse.json({
    ok: true,
    viewingAsUserId: targetId,
  });

  res.cookies.set(VIEW_AS_COOKIE, targetId, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8,
  });

  return res;
}
