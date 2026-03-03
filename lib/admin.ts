import { auth } from "@/lib/auth";

const ADMIN_EMAILS = [
  "jaydenw0711@gmail.com",
  "nshifter@tcusd.net",
];

export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email || !isAdminEmail(session.user.email)) {
    return null;
  }
  return session;
}

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.some((e) => e.toLowerCase() === email.toLowerCase());
}
