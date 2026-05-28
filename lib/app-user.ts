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
 * impersonation) has the developer-mode flag set. Used to gate
 * diagnostic admin surfaces — we always check the real account so that
 * impersonating a non-developer admin doesn't show the panels, and
 * impersonating any normal user from a developer account still does.
 *
 * Returns false (not throws) when there is no session or the row is
 * missing, so callers can use it as a simple boolean gate.
 */
export async function isCurrentDeveloper(): Promise<boolean> {
  const session = await auth();
  if (!session?.user?.id) return false;
  const row = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { isDeveloper: true },
  });
  return row?.isDeveloper === true;
}
