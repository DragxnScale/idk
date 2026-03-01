// Edge-compatible admin auth — decodes the NextAuth JWT directly from the
// cookie without touching the database (libsql is Node.js-only).
import { getToken } from "next-auth/jwt";

const ADMIN_EMAIL = "jaydenw0711@gmail.com";

export async function requireAdminEdge(request: Request) {
  const token = await getToken({
    req: request as Parameters<typeof getToken>[0]["req"],
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (!token?.email) return null;
  if ((token.email as string).toLowerCase() !== ADMIN_EMAIL.toLowerCase()) return null;

  return token;
}
