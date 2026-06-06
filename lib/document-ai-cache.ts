import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, sessionContent, studySessions } from "@/lib/db/schema";

export interface ResolvedDocument {
  documentId: string;
  userId: string;
  title: string | null;
}

/** Parse `[Page N]` markers from accumulated session text. */
export function parsePagesFromAccumulatedText(text: string): number[] {
  const matches = text.match(/\[Page (\d+)\]/g);
  if (!matches) return [];
  const pages = matches.map((m) => {
    const n = m.match(/\[Page (\d+)\]/);
    return n ? Number(n[1]) : 0;
  });
  return Array.from(new Set(pages.filter((p) => p > 0))).sort((a, b) => a - b);
}

export async function assertDocumentOwner(
  documentId: string,
  userId: string
): Promise<ResolvedDocument | null> {
  const doc = await db.query.documents.findFirst({
    where: and(eq(documents.id, documentId), eq(documents.userId, userId)),
    columns: { id: true, userId: true, title: true, sourceType: true },
  });
  if (!doc || doc.sourceType !== "upload") return null;
  return { documentId: doc.id, userId: doc.userId, title: doc.title };
}

/**
 * Resolve an upload document from a study session.
 * Checks `document_json` first, then `session_content`.
 */
export async function resolveDocumentFromSession(
  sessionId: string,
  userId: string
): Promise<ResolvedDocument | null> {
  const session = await db.query.studySessions.findFirst({
    where: and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId)),
    columns: { documentJson: true },
  });
  if (session?.documentJson) {
    try {
      const doc = JSON.parse(session.documentJson) as {
        type?: string;
        documentId?: string;
      };
      if (doc.type === "upload" && doc.documentId) {
        return assertDocumentOwner(doc.documentId, userId);
      }
    } catch {
      /* ignore malformed json */
    }
  }

  const sc = await db.query.sessionContent.findFirst({
    where: eq(sessionContent.sessionId, sessionId),
    columns: { documentId: true },
  });
  if (!sc?.documentId) return null;
  return assertDocumentOwner(sc.documentId, userId);
}
