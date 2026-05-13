import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/password";

/**
 * POST { password: string }
 *
 * Verifies the body password against the signed-in user's login password.
 * Used by Settings to unlock the login / exit password forms without
 * exposing those fields until the user proves identity.
 */
export async function POST(request: Request) {
  const authUser = await getAppUser();
  if (!authUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!password) {
    return NextResponse.json({ error: "Password required" }, { status: 400 });
  }

  const row = await db.query.users.findFirst({
    where: eq(users.id, authUser.id),
    columns: { passwordHash: true },
  });

  if (!row?.passwordHash) {
    return NextResponse.json(
      { error: "No login password on file for this account" },
      { status: 400 }
    );
  }

  const ok = await verifyPassword(password, row.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
