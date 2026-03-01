import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const allCookies = request.cookies.getAll().map((c) => ({
    name: c.name,
    length: c.value.length,
  }));

  let session = null;
  let authError = null;
  try {
    session = await auth();
  } catch (e) {
    authError = (e as Error).message;
  }

  return NextResponse.json({
    cookies: allCookies,
    session,
    authError,
    env: {
      NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? "NOT SET",
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? "set" : "NOT SET",
    },
  });
}
