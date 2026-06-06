/**
 * Rename a flashcard deck on the `/review` home screen.
 *
 *   PATCH /api/review/deck/<deckKey>
 *   body: { title: string }
 *   → { ok: true, deckKey, title } | { error: string }
 *
 * Deck-key formats (see `app/api/review/decks/route.ts`):
 *
 *   - `tc:<textbookCatalogId>` — shared textbook. We refuse the rename
 *     because textbook titles are global and changing them would affect
 *     every other user reading the same book. The UI surfaces the
 *     server's error message inline.
 *   - `d:<documentId>` — a per-user `documents` row. We verify the
 *     caller owns at least one flashcard whose session links to this
 *     document (defensive: catches the case where a card was orphaned
 *     onto another user's document somehow) and then update
 *     `documents.title`.
 *   - `untitled` — synthetic bucket for cards whose session has no
 *     document link. There's no backing row to rename, so we 400 with
 *     an explanation. (The display-side fallback added in
 *     `lib/review-deck-title.ts` is the right fix here, not a rename.)
 */
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

export const runtime = "nodejs";

type Params = { params: Promise<{ deckKey: string }> };

const MAX_TITLE_LENGTH = 200;

export async function PATCH(request: Request, { params }: Params) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { deckKey: rawDeckKey } = await params;
  const deckKey = decodeURIComponent(rawDeckKey);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rawTitle = (body as { title?: unknown })?.title;
  if (typeof rawTitle !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid `title` field" },
      { status: 400 },
    );
  }
  const title = rawTitle.trim();
  if (!title) {
    return NextResponse.json(
      { error: "Title can't be empty" },
      { status: 400 },
    );
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json(
      { error: `Title must be ${MAX_TITLE_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  if (deckKey === "untitled") {
    return NextResponse.json(
      {
        error:
          "This deck is a placeholder for cards without a linked document — there's nothing to rename. Generate flashcards from a session with a textbook or upload attached to give them a real title.",
      },
      { status: 400 },
    );
  }

  if (deckKey.startsWith("tc:")) {
    return NextResponse.json(
      {
        error:
          "This is a shared textbook — you can't rename it because the title is used by everyone reading the same book.",
      },
      { status: 403 },
    );
  }

  if (!deckKey.startsWith("d:")) {
    return NextResponse.json(
      { error: "Unknown deck key format" },
      { status: 400 },
    );
  }

  const documentId = deckKey.slice(2);
  if (!documentId) {
    return NextResponse.json({ error: "Missing document id" }, { status: 400 });
  }

  // Ownership probe: the user must have at least one flashcard whose
  // session links to this document. We check via raw SQL to keep the
  // join compact and avoid pulling whole rows we don't need.
  const ownershipRes = await db.$client.execute({
    sql: `
      SELECT 1 AS ok
      FROM flashcards f
      INNER JOIN study_sessions ss ON ss.id = f.session_id
      LEFT JOIN session_content sc ON sc.session_id = ss.id
      WHERE (ss.user_id = ? AND sc.document_id = ?)
         OR f.document_id = ?
      LIMIT 1
    `,
    args: [user.id, documentId, documentId],
  });
  if (ownershipRes.rows.length === 0) {
    // 404 (not 403) so we don't leak existence of someone else's deck.
    return NextResponse.json(
      { error: "Deck not found in your collection" },
      { status: 404 },
    );
  }

  // Also confirm the document row itself is owned by this user. The
  // join above already implies it (sessions belong to the user, and
  // session_content links them), but verifying directly closes the
  // door on shared-document edge cases.
  const doc = await db.query.documents.findFirst({
    where: (d, { eq }) => eq(d.id, documentId),
    columns: { id: true, userId: true },
  });
  if (!doc || doc.userId !== user.id) {
    return NextResponse.json(
      { error: "Deck not found in your collection" },
      { status: 404 },
    );
  }

  await db
    .update(documents)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(documents.id, documentId), eq(documents.userId, user.id)));

  return NextResponse.json({ ok: true, deckKey, title });
}
