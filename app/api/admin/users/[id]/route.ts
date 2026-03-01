import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { isAdminEmail } from "@/lib/admin";

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const target = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, params.id),
  });

  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Prevent banning yourself or other admins
  if (isAdminEmail(target.email)) {
    return NextResponse.json({ error: "Cannot ban admin account" }, { status: 400 });
  }

  // Cascade delete is handled by DB foreign keys (onDelete: cascade)
  await db.delete(users).where(eq(users.id, params.id));

  return NextResponse.json({ ok: true });
}
