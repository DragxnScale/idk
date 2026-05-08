import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";

/**
 * Defense-in-depth CSRF check used on the most destructive admin
 * mutations (delete user, toggle admin, edit ban list, impersonate).
 * NextAuth's `sameSite: lax` cookie already blocks programmatic
 * cross-origin POSTs in all modern browsers; this catches the residual
 * edge case where an attacker tricks a logged-in admin into submitting
 * a top-level HTML form to one of our endpoints.
 *
 * Returns `true` when the request looks safe (origin/referer is our own
 * host, or running locally without those headers in dev). Returns
 * `false` only when an Origin/Referer is present AND points elsewhere.
 */
export function requireSameOrigin(): boolean {
  const h = headers();
  const origin = h.get("origin");
  const referer = h.get("referer");
  const host = h.get("host");

  // No host means we can't verify; fail closed for safety.
  if (!host) return false;

  const expectedHost = host.toLowerCase();

  if (origin) {
    try {
      const u = new URL(origin);
      if (u.host.toLowerCase() !== expectedHost) return false;
    } catch {
      return false;
    }
    return true;
  }

  if (referer) {
    try {
      const u = new URL(referer);
      if (u.host.toLowerCase() !== expectedHost) return false;
      return true;
    } catch {
      return false;
    }
  }

  // Neither header present. Many same-origin fetches omit Referer due to
  // referrer-policy headers, so we don't fail closed here. Cookie sameSite
  // is the primary defense; this helper is just belt + suspenders.
  return true;
}

/**
 * Hardcoded fallback owner email. Acts as a permanent "break-glass" account
 * so the project can never be locked out of admin even if the database
 * `is_owner` flag is accidentally cleared. To migrate ownership without
 * code changes, set `users.is_owner = true` on the new owner row in Turso.
 */
const SUPER_ADMIN_EMAIL = "jaydenw0711@gmail.com";

export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email) return null;
  if (await isAdmin(session.user.email)) return session;
  return null;
}

/**
 * True if the email belongs to the hardcoded owner OR to a user row with
 * `is_admin = true` OR `is_owner = true`. Owners are implicitly admins.
 */
export async function isAdmin(email: string): Promise<boolean> {
  if (email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return true;
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
    columns: { isAdmin: true, isOwner: true },
  });
  return user?.isAdmin === true || user?.isOwner === true;
}

/**
 * Synchronous fallback used by code paths that already have the email but
 * don't want a DB call. Only matches the hardcoded owner — DB-promoted
 * owners (via `users.is_owner`) need the async `isOwner()` below.
 */
export function isSuperAdmin(email: string): boolean {
  return email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
}

/**
 * True if the email belongs to the hardcoded owner OR to a user row with
 * `is_owner = true`. Use this anywhere DB-flagged owners must also pass.
 */
export async function isOwner(email: string): Promise<boolean> {
  if (email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return true;
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
    columns: { isOwner: true },
  });
  return user?.isOwner === true;
}

/**
 * Super-owner only — checks both the hardcoded email AND `users.is_owner`
 * so you can grant owner powers in the DB without redeploying code, and
 * also so you can never lock yourself out by losing access to the email.
 */
export async function requireSuperOwner() {
  const session = await auth();
  if (!session?.user?.email) return null;
  if (!(await isOwner(session.user.email))) return null;
  return session;
}
