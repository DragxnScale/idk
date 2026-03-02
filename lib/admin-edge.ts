import { decode } from "next-auth/jwt";

const ADMIN_EMAIL = "jaydenw0711@gmail.com";
const SESSION_COOKIE = "sf.session-token";

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
    if ((token.email as string).toLowerCase() !== ADMIN_EMAIL.toLowerCase()) return null;

    return token;
  } catch {
    return null;
  }
}
