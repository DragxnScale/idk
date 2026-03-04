import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN ? "set" : "MISSING",
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? "set" : "MISSING",
    DATABASE_URL: process.env.DATABASE_URL ? "set" : "MISSING",
  });
}
