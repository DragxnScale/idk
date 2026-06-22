import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { r2PresignedPutUrl } from "@/lib/storage-backend";
import { getImageSlot } from "@/lib/ui-images-shared";
import { UI_PAGE_IDS } from "@/lib/ui-copy-shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as { page?: string; k?: string; contentType?: string };
  if (!b.page || !b.k) {
    return NextResponse.json({ error: "page and k are required" }, { status: 400 });
  }
  if (!(UI_PAGE_IDS as readonly string[]).includes(b.page)) {
    return NextResponse.json({ error: "Invalid page" }, { status: 400 });
  }
  const slot = getImageSlot(b.page as (typeof UI_PAGE_IDS)[number], b.k);
  if (!slot) {
    return NextResponse.json({ error: "Unknown image slot" }, { status: 400 });
  }

  const ext = b.contentType === "image/jpeg" ? "jpg" : "png";
  const key = `ui-assets/${b.page}/${b.k}/${randomUUID()}.${ext}`;

  try {
    const { uploadUrl, objectUrl } = await r2PresignedPutUrl(key, {
      contentType: b.contentType ?? "image/png",
      expiresInSeconds: 60 * 15,
    });
    return NextResponse.json({ uploadUrl, objectUrl, key });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
