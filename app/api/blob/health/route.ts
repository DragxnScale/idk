import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";

/** Admin-only — do not expose env configuration to anonymous or normal users. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.email || !(await isAdmin(session.user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    R2_ENDPOINT: process.env.R2_ENDPOINT ? "set" : "MISSING",
    R2_BUCKET: process.env.R2_BUCKET ? "set" : "MISSING",
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ? "set" : "MISSING",
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ? "set" : "MISSING",
    R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL ? "set" : "missing (byte-proxy fallback active)",
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? "set" : "MISSING",
    DATABASE_URL: process.env.DATABASE_URL ? "set" : "MISSING",
  });
}
