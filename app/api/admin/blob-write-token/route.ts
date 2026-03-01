import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

// Returns the raw Vercel Blob write token to the admin client so it can
// upload directly to Vercel Blob's REST API without the callback round-trip
// that causes upload() to hang. Admin-only — safe to expose to this user.
export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN is not configured." },
      { status: 503 }
    );
  }

  return NextResponse.json({ token });
}
