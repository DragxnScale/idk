import type { ResultSet } from "@libsql/client";
import { db } from "@/lib/db";
import type { AiStoredContentSectionId } from "@/lib/ai-stored-content-sections";

function countRows(res: ResultSet): number {
  return Number(res.rows[0]?.n ?? 0);
}

/** Row counts for admin AI Content sections (notes = session + public + document). */
export async function fetchAiContentCounts(): Promise<
  Record<AiStoredContentSectionId, number>
> {
  const [notesSession, notesPublic, notesDocument, quiz, flashcards, velGames, velBank] =
    await Promise.all([
      db.$client.execute("SELECT count(*) AS n FROM ai_notes"),
      db.$client.execute("SELECT count(*) AS n FROM public_notes"),
      db.$client.execute("SELECT count(*) AS n FROM document_notes"),
      db.$client.execute(
        "SELECT coalesce(sum(json_array_length(questions_json)), 0) AS n FROM quizzes"
      ),
      db.$client.execute("SELECT count(*) AS n FROM flashcards"),
      db.$client.execute("SELECT count(*) AS n FROM velocity_games"),
      db.$client.execute("SELECT count(*) AS n FROM velocity_question_bank"),
    ]);

  return {
    notes:
      countRows(notesSession) + countRows(notesPublic) + countRows(notesDocument),
    quiz: countRows(quiz),
    flashcards: countRows(flashcards),
    "velocity-games": countRows(velGames),
    "velocity-bank": countRows(velBank),
  };
}
