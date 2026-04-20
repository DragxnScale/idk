import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await db.query.studySessions.findFirst({
    where: (s, { eq, and }) =>
      and(eq(s.id, params.id), eq(s.userId, user.id)),
  });

  if (!row) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json(row);
}
