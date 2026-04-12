import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const SUPER_ADMIN_EMAIL = "jaydenw0711@gmail.com";

export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email) return null;
  if (await isAdmin(session.user.email)) return session;
  return null;
}

export async function isAdmin(email: string): Promise<boolean> {
  if (email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return true;
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
    columns: { isAdmin: true },
  });
  return user?.isAdmin === true;
}

export function isSuperAdmin(email: string): boolean {
  return email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
}

/** Super-owner only (hardcoded email) — not the same as DB `isAdmin`. */
export async function requireSuperOwner() {
  const session = await auth();
  if (!session?.user?.email) return null;
  if (!isSuperAdmin(session.user.email)) return null;
  return session;
}
