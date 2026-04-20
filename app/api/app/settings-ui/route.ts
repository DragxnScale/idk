import { NextResponse } from "next/server";
import { getSettingsUiPayload } from "@/lib/settings-ui";

export const dynamic = "force-dynamic";

/** Public read: global Settings page copy / typography overrides (admin-authored). */
export async function GET() {
  const data = await getSettingsUiPayload();
  return NextResponse.json(data);
}
