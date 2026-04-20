import { NextRequest, NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { studyPlans } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function GET() {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.query.studyPlans.findMany({
    where: (p, { eq: e }) => e(p.userId, user.id),
    orderBy: (p, { asc }) => [asc(p.dayOfWeek), asc(p.startTime)],
  });

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { dayOfWeek, startTime, endTime, label, textbookCatalogId } = body;

  if (dayOfWeek == null || !startTime || !endTime) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const id = randomUUID();
  const row = {
    id,
    userId: user.id,
    dayOfWeek: Number(dayOfWeek),
    startTime,
    endTime,
    label: label ?? null,
    textbookCatalogId: textbookCatalogId ?? null,
    createdAt: new Date(),
  };

  await db.insert(studyPlans).values(row);
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await db
    .delete(studyPlans)
    .where(and(eq(studyPlans.id, id), eq(studyPlans.userId, user.id)));

  return NextResponse.json({ ok: true });
}
