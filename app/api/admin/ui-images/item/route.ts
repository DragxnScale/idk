import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { patchUiImage, type UiImageElement } from "@/lib/ui-images";
import { UI_PAGE_IDS } from "@/lib/ui-copy-shared";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as { page?: string; k?: string; element?: unknown };
  if (!b.page || !b.k || typeof b.k !== "string") {
    return NextResponse.json({ error: "page and k are required" }, { status: 400 });
  }
  if (!(UI_PAGE_IDS as readonly string[]).includes(b.page)) {
    return NextResponse.json({ error: "Invalid page" }, { status: 400 });
  }
  if (!b.element || typeof b.element !== "object" || Array.isArray(b.element)) {
    return NextResponse.json({ error: "element must be an object" }, { status: 400 });
  }
  const el = b.element as UiImageElement;
  if (!el.src || typeof el.src !== "string") {
    return NextResponse.json({ error: "element.src is required" }, { status: 400 });
  }

  const payload = await patchUiImage(b.page as (typeof UI_PAGE_IDS)[number], b.k, el);
  return NextResponse.json(payload);
}
