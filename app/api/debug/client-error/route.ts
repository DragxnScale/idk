import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { clientErrorLogs } from "@/lib/db/schema";

/** Accepts browser error reports for the admin debug log. Anonymous ok. */

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const message =
    typeof raw.message === "string"
      ? raw.message.slice(0, 4000)
      : String(raw.reason ?? raw.error ?? "Unknown error").slice(0, 4000);
  const stack =
    typeof raw.stack === "string"
      ? raw.stack.slice(0, 32000)
      : raw.stack != null
        ? String(raw.stack).slice(0, 32000)
        : null;
  const url =
    typeof raw.url === "string"
      ? raw.url.slice(0, 2048)
      : typeof raw.source === "string"
        ? raw.source.slice(0, 2048)
        : null;
  const ua = request.headers.get("user-agent")?.slice(0, 2048) ?? null;

  let extraJson: string | null = null;
  if (raw.extra != null) {
    try {
      extraJson = JSON.stringify(raw.extra).slice(0, 16000);
    } catch {
      extraJson = null;
    }
  }

  const user = await getAppUser();

  await db.insert(clientErrorLogs).values({
    id: crypto.randomUUID(),
    createdAt: new Date(),
    userId: user?.id ?? null,
    email: user?.email ?? null,
    message,
    stack,
    url,
    userAgent: ua,
    extra: extraJson,

  });

  return NextResponse.json({ ok: true });
}
