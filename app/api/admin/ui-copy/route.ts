import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import {
  ensureAllPages,
  getUiCopyPayload,
  setUiCopyPayload,
  type UiCopyElement,
  type UiCopyPayload,
  UI_PAGE_IDS,
} from "@/lib/ui-copy";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const data = await getUiCopyPayload();
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
  const b = body as { version?: number; pages?: unknown };
  if (b.version !== 2 || !b.pages || typeof b.pages !== "object" || Array.isArray(b.pages)) {
    return NextResponse.json({ error: "Body must be { version: 2, pages: { ... } }" }, { status: 400 });
  }
  const rawPages = b.pages as Record<string, unknown>;
  for (const id of UI_PAGE_IDS) {
    const block = rawPages[id];
    if (block !== undefined && (typeof block !== "object" || block === null || Array.isArray(block))) {
      return NextResponse.json({ error: `pages.${id} must be an object` }, { status: 400 });
    }
  }
  const payload: UiCopyPayload = {
    version: 2,
    pages: ensureAllPages(
      rawPages as Partial<Record<(typeof UI_PAGE_IDS)[number], Record<string, UiCopyElement>>>
    ),
  };
  await setUiCopyPayload(payload);
  return NextResponse.json(payload);
}
