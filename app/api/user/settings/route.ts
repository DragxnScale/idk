import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/password";

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { currentPassword, newExitPassword } = await request.json();
  if (!currentPassword || !newExitPassword) {
    return NextResponse.json(
      { error: "currentPassword and newExitPassword are required" },
      { status: 400 }
    );
  }

  if (newExitPassword.length < 4) {
    return NextResponse.json(
      { error: "Exit password must be at least 4 characters" },
      { status: 400 }
    );
  }

  const user = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, session.user.id),
  });

  if (!user || !user.passwordHash) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Always authenticate with the login password
  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    return NextResponse.json(
      { error: "Incorrect login password" },
      { status: 401 }
    );
  }

  const exitPasswordHash = await hashPassword(newExitPassword);

  await db
    .update(users)
    .set({ exitPasswordHash })
    .where(eq(users.id, session.user.id));

  return NextResponse.json({ ok: true });
}
