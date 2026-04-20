import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";

export async function POST(request: Request) {
  const authUser = await getAppUser();
  if (!authUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { password } = await request.json();
  if (!password) {
    return NextResponse.json({ error: "Password required" }, { status: 400 });
  }

  const row = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, authUser.id),
  });

  if (!row) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Use exit password if set, otherwise fall back to login password
  const hashToCheck = row.exitPasswordHash ?? row.passwordHash;
  if (!hashToCheck) {
    return NextResponse.json({ error: "No password set" }, { status: 400 });
  }

  const valid = await verifyPassword(password, hashToCheck);
  if (!valid) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
