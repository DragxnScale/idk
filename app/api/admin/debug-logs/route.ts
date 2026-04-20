import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireSuperOwner } from "@/lib/admin";
import { db } from "@/lib/db";
import { clientErrorLogs, users } from "@/lib/db/schema";

/** Super-owner only: user-facing errors vs owner dev-debug lines. */

export async function GET(request: Request) {
  const session = await requireSuperOwner();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 80, 1), 200);

  const baseSelect = {
    id: clientErrorLogs.id,
    createdAt: clientErrorLogs.createdAt,
    userId: clientErrorLogs.userId,
    email: clientErrorLogs.email,
    message: clientErrorLogs.message,
    stack: clientErrorLogs.stack,
    url: clientErrorLogs.url,
    userAgent: clientErrorLogs.userAgent,
    extra: clientErrorLogs.extra,
    userName: users.name,
  };

  const [userRows, devRows] = await Promise.all([
    db
      .select(baseSelect)
      .from(clientErrorLogs)
      .leftJoin(users, eq(clientErrorLogs.userId, users.id))
      .where(eq(clientErrorLogs.kind, "user"))
      .orderBy(desc(clientErrorLogs.createdAt))
      .limit(limit),
    db
      .select(baseSelect)
      .from(clientErrorLogs)
      .leftJoin(users, eq(clientErrorLogs.userId, users.id))
      .where(eq(clientErrorLogs.kind, "dev"))
      .orderBy(desc(clientErrorLogs.createdAt))
      .limit(limit),
  ]);

  const mapRow = (r: (typeof userRows)[0]) => ({
    id: r.id,
    createdAt: r.createdAt?.toISOString?.() ?? null,
    userId: r.userId,
    email: r.email,
    userName: r.userName ?? null,
    message: r.message,
    stack: r.stack,
    url: r.url,
    userAgent: r.userAgent,
    extra: r.extra ? safeParseJson(r.extra) : null,
  });

  return NextResponse.json({
    userLogs: userRows.map(mapRow),
    devLogs: devRows.map(mapRow),
  });
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
