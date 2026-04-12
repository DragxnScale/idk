import { NextResponse } from "next/server";
import { requireSuperOwner } from "@/lib/admin";
import { MODEL } from "@/lib/ai";
import { getAiOwnerStyleExtra, setAiOwnerStyleExtra } from "@/lib/app-settings";

export async function GET() {
  const session = await requireSuperOwner();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const noteStyleExtra = await getAiOwnerStyleExtra();
  return NextResponse.json({ noteStyleExtra, model: MODEL });
}

export async function PATCH(request: Request) {
  const session = await requireSuperOwner();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const noteStyleExtra =
    typeof body.noteStyleExtra === "string" ? body.noteStyleExtra : "";
  if (noteStyleExtra.length > 8000) {
    return NextResponse.json(
      { error: "Style instructions must be 8000 characters or less" },
      { status: 400 }
    );
  }

  await setAiOwnerStyleExtra(noteStyleExtra);
  return NextResponse.json({ ok: true, noteStyleExtra: noteStyleExtra.trim() });
}
