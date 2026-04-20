import { NextResponse } from "next/server";
import { getUiCopyPayload } from "@/lib/ui-copy";

export const dynamic = "force-dynamic";

/** Public read: global app UI copy and typography overrides (admin-authored, per page). */
export async function GET() {
  const data = await getUiCopyPayload();
  return NextResponse.json(data);
}
