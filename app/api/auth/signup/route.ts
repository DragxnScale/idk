import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, bannedEmails } from "@/lib/db/schema";
import { hashPassword } from "@/lib/password";
import { eq } from "drizzle-orm";

export async function POST(request: Request) {
  const body = await request.json();
  const email = (body.email as string)?.toLowerCase().trim();
  const password = body.password as string;
  const name = (body.name as string)?.trim();

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  const banned = await db.query.bannedEmails.findFirst({
    where: eq(bannedEmails.email, email),
  });
  if (banned) {
    return NextResponse.json(
      { error: "This email has been suspended." },
      { status: 403 }
    );
  }

  const existing = await db.query.users.findFirst({
    where: (u, { eq: e }) => e(u.email, email),
  });

  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 409 }
    );
  }

  const id = crypto.randomUUID();
  const now = new Date();
  const passwordHash = await hashPassword(password);

  try {
    await db.insert(users).values({
      id,
      email,
      name: name || email.split("@")[0],
      passwordHash,
      createdAt: now,
      updatedAt: now,
    });
  } catch (e) {
    console.error("Signup DB error:", e);
    return NextResponse.json(
      { error: "Failed to create account. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
