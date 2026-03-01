import { auth } from "@/lib/auth";

const ADMIN_EMAIL = "jaydenw0711@gmail.com";

export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email || session.user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return null;
  }
  return session;
}

export function isAdminEmail(email: string): boolean {
  return email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}
