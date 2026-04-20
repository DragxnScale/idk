import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";
import { getSettingsUiPayload, setSettingsUiPayload, type SettingsUiPayload, type SettingsUiElement } from "@/lib/settings-ui";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const data = await getSettingsUiPayload();
  return NextResponse.json(data);
}

export async function PUT(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = body as { version?: number; elements?: unknown };
  if (!b.elements || typeof b.elements !== "object" || Array.isArray(b.elements)) {
    return NextResponse.json({ error: "Body must include elements object" }, { status: 400 });
  }
  const payload: SettingsUiPayload = { version: 1, elements: b.elements as Record<string, SettingsUiElement> };
  await setSettingsUiPayload(payload);
  return NextResponse.json(payload);
}
