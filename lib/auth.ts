import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { decode } from "next-auth/jwt";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/password";

const SESSION_COOKIE = "sf.session-token";

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/auth/signin" },
  useSecureCookies: false,
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE,
      options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure: true },
    },
    callbackUrl: {
      name: "sf.callback-url",
      options: { sameSite: "lax" as const, path: "/", secure: true },
    },
    csrfToken: {
      name: "sf.csrf-token",
      options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure: true },
    },
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = credentials.email.toLowerCase().trim();

        const user = await db.query.users.findFirst({
          where: (u, { eq }) => eq(u.email, email),
        });

        if (!user || !user.passwordHash) return null;

        const valid = await verifyPassword(credentials.password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
};

/**
 * Decode the session JWT directly from cookies — bypasses getServerSession
 * which can fail behind reverse proxies (Railway) due to NEXTAUTH_URL issues.
 */
export async function auth(): Promise<{ user: { id: string; email: string; name: string } } | null> {
  const cookieStore = cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  try {
    const token = await decode({
      token: raw,
      secret: process.env.NEXTAUTH_SECRET!,
      salt: "",
    });
    if (!token?.id) return null;

    return {
      user: {
        id: token.id as string,
        email: (token.email as string) ?? "",
        name: (token.name as string) ?? "",
      },
    };
  } catch {
    return null;
  }
}
