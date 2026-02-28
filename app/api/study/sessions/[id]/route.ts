import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = store.getSession(params.id, session.user.id);

  if (!row) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json(row);
}
