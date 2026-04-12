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
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN ? "set" : "MISSING",
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? "set" : "MISSING",
    DATABASE_URL: process.env.DATABASE_URL ? "set" : "MISSING",
  });
}
