import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { clientErrorLogs } from "@/lib/db/schema";

export async function GET(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200);

  const rows = await db.query.clientErrorLogs.findMany({
    orderBy: [desc(clientErrorLogs.createdAt)],
    limit,
  });

  return NextResponse.json({
    logs: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt?.toISOString?.() ?? null,
      userId: r.userId,
      email: r.email,
      message: r.message,
      stack: r.stack,
      url: r.url,
      userAgent: r.userAgent,
      extra: r.extra ? safeParseJson(r.extra) : null,
    })),
  });
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
