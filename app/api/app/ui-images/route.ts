import { NextResponse } from "next/server";
import { getUiImagesPayload } from "@/lib/ui-images";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getUiImagesPayload();
  return NextResponse.json(data);
}
