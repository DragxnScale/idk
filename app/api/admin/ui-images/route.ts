import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getUiImagesPayload } from "@/lib/ui-images";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const data = await getUiImagesPayload();
  return NextResponse.json(data);
}
