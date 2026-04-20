import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";

export async function GET() {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.query.bookmarks.findMany({
    where: (b, { eq: e }) => e(b.userId, user.id),
    orderBy: (b, { desc: d }) => d(b.createdAt),
  });

  // Gather unique session IDs and document IDs
  const sessionIds = Array.from(new Set(rows.map((r) => r.sessionId).filter(Boolean)));
  const documentIds = Array.from(new Set(rows.map((r) => r.documentId)));

  const sessionRows =
    sessionIds.length > 0
      ? await Promise.all(
          sessionIds.map((sid) =>
            db.query.studySessions.findFirst({
              where: (s, { eq: e }) => e(s.id, sid!),
            })
          )
        )
      : [];

  const docRows =
    documentIds.length > 0
      ? await Promise.all(
          documentIds.map((did) =>
            db.query.documents.findFirst({
              where: (d, { eq: e }) => e(d.id, did),
            })
          )
        )
      : [];

  const sessionMap = new Map(
    sessionRows
      .filter(Boolean)
      .map((s) => [
        s!.id,
        {
          startedAt: s!.startedAt?.toISOString() ?? null,
          documentJson: s!.documentJson,
        },
      ])
  );

  const docMap = new Map(
    docRows.filter(Boolean).map((d) => [d!.id, d!])
  );

  // Also look up textbook catalog entries for textbook-type documents
  const catalogIds = Array.from(
    new Set(
      docRows
        .filter(Boolean)
        .map((d) => d!.textbookCatalogId)
        .filter(Boolean)
    )
  );
  const catalogRows =
    catalogIds.length > 0
      ? await Promise.all(
          catalogIds.map((cid) =>
            db.query.textbookCatalog.findFirst({
              where: (t, { eq: e }) => e(t.id, cid!),
            })
          )
        )
      : [];
  const catalogMap = new Map(
    catalogRows.filter(Boolean).map((c) => [c!.id, c!])
  );

  const enriched = rows.map((r) => {
    const sess = r.sessionId ? sessionMap.get(r.sessionId) : null;
    const doc = docMap.get(r.documentId);

    let docTitle: string | null = doc?.title ?? null;
    let pdfUrl: string | null = null;

    // Try getting URL from the document record
    if (doc?.fileUrl) {
      pdfUrl = doc.fileUrl;
    }
    if (doc?.textbookCatalogId) {
      const catalog = catalogMap.get(doc.textbookCatalogId);
      if (catalog?.sourceUrl) pdfUrl = catalog.sourceUrl;
      if (!docTitle && catalog?.title) docTitle = catalog.title;
    }

    // Fallback: try documentJson from the session
    if (sess?.documentJson) {
      try {
        const parsed = JSON.parse(sess.documentJson);
        if (!docTitle) docTitle = parsed.title ?? null;
        if (!pdfUrl && parsed.sourceUrl) pdfUrl = parsed.sourceUrl;
      } catch {}
    }

    return {
      ...r,
      createdAt: r.createdAt?.toISOString() ?? null,
      sessionDate: sess?.startedAt ?? null,
      docTitle,
      pdfUrl,
    };
  });

  return NextResponse.json(enriched);
}
