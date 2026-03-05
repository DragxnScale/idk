import { decode } from "next-auth/jwt";
import { createClient } from "@libsql/client/web";

const SUPER_ADMIN_EMAIL = "jaydenw0711@gmail.com";
const SESSION_COOKIE = "sf.session-token";

async function isAdminEdge(email: string): Promise<boolean> {
  if (email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return true;
  try {
    const client = createClient({
      url: process.env.DATABASE_URL!,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
    const result = await client.execute({
      sql: "SELECT is_admin FROM users WHERE lower(email) = lower(?) LIMIT 1",
      args: [email],
    });
    return result.rows[0]?.is_admin === 1;
  } catch {
    return false;
  }
}

export async function requireAdminEdge(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  const raw = match?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return null;

  try {
    const token = await decode({
      token: decodeURIComponent(raw),
      secret: process.env.NEXTAUTH_SECRET!,
      salt: "",
    });

    if (!token?.email) return null;
    if (!(await isAdminEdge(token.email as string))) return null;

    return token;
  } catch {
    return null;
  }
}
