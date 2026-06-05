import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/** HttpOnly cookie set by POST /api/admin/impersonate when an admin views the app as another user. */
export const VIEW_AS_COOKIE = "sf.view-as-user";

/**
 * Effective signed-in user for normal (non-admin) API routes.
 * Admins may have {@link VIEW_AS_COOKIE} set to another user's id to debug as them.
 * Admin routes must keep using {@link auth} only so authorization stays on the real account.
 */
export async function getAppUser(): Promise<{ id: string; email: string; name: string } | null> {
  const session = await auth();
  if (!session) return null;
  if (!(await isAdmin(session.user.email))) return session.user;
  const viewAsId = cookies().get(VIEW_AS_COOKIE)?.value;
  if (!viewAsId || viewAsId === session.user.id) return session.user;
  const target = await db.query.users.findFirst({
    where: eq(users.id, viewAsId),
    columns: { id: true, email: true, name: true },
  });
  if (!target) return session.user;
  return { id: target.id, email: target.email, name: target.name ?? "" };
}

/**
 * Returns true when the **real signed-in account** (ignoring view-as
 * impersonation) should see the developer-mode admin surfaces. Used to
 * gate diagnostic admin surfaces — we always check the real account so
 * that impersonating a regular user from an admin still shows the
 * panels, and a non-admin viewer never does.
 *
 * As of 2026-06, this is equivalent to "is admin": the user-facing
 * Developer-mode toggle was removed because all admin pages already
 * gate themselves behind admin auth, so there's no reason to require
 * a second opt-in. The `users.is_developer` column is retained for
 * backwards compat but is no longer read here.
 *
 * Returns false (not throws) when there is no session, so callers can
 * use it as a simple boolean gate.
 */
export async function isCurrentDeveloper(): Promise<boolean> {
  const session = await auth();
  if (!session?.user?.email) return false;
  return isAdmin(session.user.email);
}
