import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const cookies = Object.fromEntries(
    request.cookies.getAll().map((c) => [c.name, c.value.slice(0, 20) + "…"])
  );

  let jwtToken = null;
  try {
    jwtToken = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
      cookieName: "sf.session-token",
    });
  } catch (e) {
    jwtToken = { error: (e as Error).message };
  }

  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch (e) {
    session = { error: (e as Error).message };
  }

  return NextResponse.json({
    cookies,
    jwtToken,
    session,
    env: {
      NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? "NOT SET",
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? "set" : "NOT SET",
    },
  });
}
