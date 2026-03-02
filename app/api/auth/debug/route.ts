import { NextRequest, NextResponse } from "next/server";
import { decode } from "next-auth/jwt";

const CUSTOM_COOKIE = "sf.session-token";
const DEFAULT_COOKIE = "next-auth.session-token";
const SECURE_COOKIE = "__Secure-next-auth.session-token";

export async function GET(request: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET!;
  const allCookies = request.cookies.getAll().map((c) => ({
    name: c.name,
    length: c.value.length,
  }));

  const results: Record<string, unknown> = {};

  // Try decoding each session-like cookie with different salts
  for (const cookieName of [CUSTOM_COOKIE, DEFAULT_COOKIE, SECURE_COOKIE]) {
    const raw = request.cookies.get(cookieName)?.value;
    if (!raw) {
      results[cookieName] = "cookie not present";
      continue;
    }

    // Try salt = cookie name itself
    for (const salt of [cookieName, CUSTOM_COOKIE, DEFAULT_COOKIE, SECURE_COOKIE, ""]) {
      const key = `${cookieName} + salt="${salt}"`;
      try {
        const token = await decode({ token: raw, secret, salt });
        if (token) {
          results[key] = { decoded: true, id: token.id, email: token.email, sub: token.sub, iat: token.iat };
        } else {
          results[key] = "decode returned null";
        }
      } catch (e) {
        results[key] = `error: ${(e as Error).message}`;
      }
    }
  }

  return NextResponse.json({
    cookies: allCookies,
    decodeTests: results,
    env: {
      NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? "NOT SET",
      NEXTAUTH_SECRET: secret ? `set (${secret.length} chars)` : "NOT SET",
    },
  });
}
