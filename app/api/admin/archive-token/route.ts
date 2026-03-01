import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const accessKey = process.env.ARCHIVE_ACCESS_KEY;
  const secretKey = process.env.ARCHIVE_SECRET_KEY;

  if (!accessKey || !secretKey) {
    return NextResponse.json(
      { error: "Archive.org credentials not configured. Add ARCHIVE_ACCESS_KEY and ARCHIVE_SECRET_KEY to your environment variables." },
      { status: 503 }
    );
  }

  return NextResponse.json({ accessKey, secretKey });
}
