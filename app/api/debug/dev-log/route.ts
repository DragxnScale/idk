import { NextResponse } from "next/server";
import { requireSuperOwner } from "@/lib/admin";
import { db } from "@/lib/db";
import { clientErrorLogs } from "@/lib/db/schema";

/**
 * Owner-only: append a developer debug line while building features.
 * Call from `reportDevDebug()` in `lib/dev-debug.ts` (or POST manually when signed in as owner).
 */

export async function POST(request: Request) {
  const session = await requireSuperOwner();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const message =
    typeof raw.message === "string"
      ? raw.message.slice(0, 8000)
      : String(raw.message ?? "").slice(0, 8000);
  if (!message.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  let extraJson: string | null = null;
  if (raw.extra != null) {
    try {
      extraJson = JSON.stringify(raw.extra).slice(0, 32000);
    } catch {
      extraJson = null;
    }
  }

  const stack =
    typeof raw.stack === "string"
      ? raw.stack.slice(0, 32000)
      : raw.stack != null
        ? String(raw.stack).slice(0, 32000)
        : null;

  await db.insert(clientErrorLogs).values({
    id: crypto.randomUUID(),
    createdAt: new Date(),
    kind: "dev",
    userId: session.user.id,
    email: session.user.email ?? null,
    message,
    stack,
    url: typeof raw.url === "string" ? raw.url.slice(0, 2048) : null,
    userAgent: null,
    extra: extraJson,
  });

  return NextResponse.json({ ok: true });
}
