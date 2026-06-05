import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import {
  type ContentSource,
  previewText,
  resolveSourceFromCatalog,
  resolveSourceFromSession,
  resolveSourceFromVelocityBank,
} from "@/lib/ai-content-source";
import {
  AI_STORED_CONTENT_SECTIONS,
  DEFAULT_CONTENT_PAGE_SIZE,
  MAX_CONTENT_PAGE_SIZE,
  type AiStoredContentSectionId,
  isValidContentSection,
} from "@/lib/ai-stored-content-sections";

export const runtime = "nodejs";

const SESSION_SOURCE_JOIN = `
  LEFT JOIN session_content sc ON sc.session_id = ss.id
  LEFT JOIN documents d ON d.id = sc.document_id
  LEFT JOIN textbook_catalog tc ON tc.id = d.textbook_catalog_id
`;

function tsToIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const ms = n < 1e12 ? n * 1000 : n;
  return new Date(ms).toISOString();
}

function rowStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s.length ? s : null;
}

function sessionSourceFromRow(
  r: Record<string, unknown>,
  page: number | null
): ContentSource {
  return resolveSourceFromSession({
    catalogTitle: rowStr(r.catalogTitle),
    documentTitle: rowStr(r.documentTitle),
    catalogId: rowStr(r.catalogId),
    documentId: rowStr(r.documentId),
    catalogRangesJson: rowStr(r.catalogRangesJson),
    documentRangesJson: rowStr(r.documentRangesJson),
    documentJson: rowStr(r.documentJson),
    page,
  });
}

async function fetchCounts(): Promise<Record<AiStoredContentSectionId, number>> {
  const [notesSession, notesPublic, quiz, flashcards, velGames, velBank] =
    await Promise.all([
      db.$client.execute("SELECT count(*) AS n FROM ai_notes"),
      db.$client.execute("SELECT count(*) AS n FROM public_notes"),
      db.$client.execute("SELECT count(*) AS n FROM quizzes"),
      db.$client.execute("SELECT count(*) AS n FROM flashcards"),
      db.$client.execute("SELECT count(*) AS n FROM velocity_games"),
      db.$client.execute("SELECT count(*) AS n FROM velocity_question_bank"),
    ]);

  const n = (res: { rows: { n: unknown }[] }) => Number(res.rows[0]?.n ?? 0);

  return {
    notes: n(notesSession) + n(notesPublic),
    quiz: n(quiz),
    flashcards: n(flashcards),
    "velocity-games": n(velGames),
    "velocity-bank": n(velBank),
  };
}

async function fetchNotes(
  notesType: "session" | "public" | "all",
  page: number,
  limit: number
) {
  const offset = (page - 1) * limit;

  if (notesType === "session") {
    const countRes = await db.$client.execute(
      "SELECT count(*) AS n FROM ai_notes"
    );
    const total = Number(countRes.rows[0]?.n ?? 0);
    const res = await db.$client.execute({
      sql: `
        SELECT
          an.id,
          an.content,
          an.page_number AS pageNumber,
          an.created_at AS createdAt,
          u.email AS userEmail,
          u.name AS userName,
          ss.id AS sessionId,
          tc.title AS catalogTitle,
          d.title AS documentTitle,
          tc.id AS catalogId,
          d.id AS documentId,
          tc.chapter_page_ranges AS catalogRangesJson,
          d.chapter_page_ranges AS documentRangesJson,
          ss.document_json AS documentJson
        FROM ai_notes an
        INNER JOIN study_sessions ss ON ss.id = an.session_id
        INNER JOIN users u ON u.id = ss.user_id
        ${SESSION_SOURCE_JOIN}
        ORDER BY an.created_at DESC
        LIMIT ? OFFSET ?
      `,
      args: [limit, offset],
    });
    const items = res.rows.map((r) => {
      const pageNum =
        r.pageNumber == null ? null : Number(r.pageNumber);
      return {
        kind: "session" as const,
        id: String(r.id),
        userEmail: rowStr(r.userEmail),
        userName: rowStr(r.userName),
        sessionId: String(r.sessionId),
        createdAt: tsToIso(r.createdAt),
        preview: previewText(String(r.content ?? "")),
        fullContent: String(r.content ?? ""),
        source: sessionSourceFromRow(r as Record<string, unknown>, pageNum),
      };
    });
    return { total, items, hasMore: offset + items.length < total };
  }

  if (notesType === "public") {
    const countRes = await db.$client.execute(
      "SELECT count(*) AS n FROM public_notes"
    );
    const total = Number(countRes.rows[0]?.n ?? 0);
    const res = await db.$client.execute({
      sql: `
        SELECT
          pn.id,
          pn.content,
          pn.page_number AS pageNumber,
          pn.prompt_version AS promptVersion,
          pn.updated_at AS updatedAt,
          tc.title AS catalogTitle,
          tc.chapter_page_ranges AS catalogRangesJson
        FROM public_notes pn
        INNER JOIN textbook_catalog tc ON tc.id = pn.textbook_catalog_id
        ORDER BY pn.updated_at DESC
        LIMIT ? OFFSET ?
      `,
      args: [limit, offset],
    });
    const items = res.rows.map((r) => {
      const pageNum =
        r.pageNumber == null ? null : Number(r.pageNumber);
      return {
        kind: "public" as const,
        id: String(r.id),
        promptVersion: Number(r.promptVersion ?? 1),
        createdAt: tsToIso(r.updatedAt),
        preview: previewText(String(r.content ?? "")),
        fullContent: String(r.content ?? ""),
        source: resolveSourceFromCatalog(
          rowStr(r.catalogTitle),
          rowStr(r.catalogRangesJson),
          pageNum
        ),
      };
    });
    return { total, items, hasMore: offset + items.length < total };
  }

  // all — UNION sorted by timestamp
  const countRes = await db.$client.execute({
    sql: `
      SELECT
        (SELECT count(*) FROM ai_notes) +
        (SELECT count(*) FROM public_notes) AS n
    `,
  });
  const total = Number(countRes.rows[0]?.n ?? 0);
  const res = await db.$client.execute({
    sql: `
      SELECT * FROM (
        SELECT
          'session' AS kind,
          an.id,
          an.content,
          an.page_number AS pageNumber,
          an.created_at AS sortAt,
          u.email AS userEmail,
          u.name AS userName,
          ss.id AS sessionId,
          NULL AS promptVersion,
          tc.title AS catalogTitle,
          d.title AS documentTitle,
          tc.id AS catalogId,
          d.id AS documentId,
          tc.chapter_page_ranges AS catalogRangesJson,
          d.chapter_page_ranges AS documentRangesJson,
          ss.document_json AS documentJson
        FROM ai_notes an
        INNER JOIN study_sessions ss ON ss.id = an.session_id
        INNER JOIN users u ON u.id = ss.user_id
        ${SESSION_SOURCE_JOIN}
        UNION ALL
        SELECT
          'public' AS kind,
          pn.id,
          pn.content,
          pn.page_number AS pageNumber,
          pn.updated_at AS sortAt,
          NULL AS userEmail,
          NULL AS userName,
          NULL AS sessionId,
          pn.prompt_version AS promptVersion,
          tc.title AS catalogTitle,
          NULL AS documentTitle,
          tc.id AS catalogId,
          NULL AS documentId,
          tc.chapter_page_ranges AS catalogRangesJson,
          NULL AS documentRangesJson,
          NULL AS documentJson
        FROM public_notes pn
        INNER JOIN textbook_catalog tc ON tc.id = pn.textbook_catalog_id
      )
      ORDER BY sortAt DESC
      LIMIT ? OFFSET ?
    `,
    args: [limit, offset],
  });

  const items = res.rows.map((r) => {
    const kind = String(r.kind) as "session" | "public";
    const pageNum = r.pageNumber == null ? null : Number(r.pageNumber);
    const base = {
      kind,
      id: String(r.id),
      createdAt: tsToIso(r.sortAt),
      preview: previewText(String(r.content ?? "")),
      fullContent: String(r.content ?? ""),
    };
    if (kind === "session") {
      return {
        ...base,
        userEmail: rowStr(r.userEmail),
        userName: rowStr(r.userName),
        sessionId: String(r.sessionId),
        source: sessionSourceFromRow(r as Record<string, unknown>, pageNum),
      };
    }
    return {
      ...base,
      promptVersion: Number(r.promptVersion ?? 1),
      source: resolveSourceFromCatalog(
        rowStr(r.catalogTitle),
        rowStr(r.catalogRangesJson),
        pageNum
      ),
    };
  });

  return { total, items, hasMore: offset + items.length < total };
}

async function fetchQuiz(page: number, limit: number) {
  const offset = (page - 1) * limit;
  const countRes = await db.$client.execute("SELECT count(*) AS n FROM quizzes");
  const total = Number(countRes.rows[0]?.n ?? 0);
  const res = await db.$client.execute({
    sql: `
      SELECT
        q.id,
        q.questions_json AS questionsJson,
        q.review_json AS reviewJson,
        q.score,
        q.total_questions AS totalQuestions,
        q.created_at AS createdAt,
        u.email AS userEmail,
        u.name AS userName,
        ss.id AS sessionId,
        tc.title AS catalogTitle,
        d.title AS documentTitle,
        tc.id AS catalogId,
        d.id AS documentId,
        tc.chapter_page_ranges AS catalogRangesJson,
        d.chapter_page_ranges AS documentRangesJson,
        ss.document_json AS documentJson
      FROM quizzes q
      INNER JOIN study_sessions ss ON ss.id = q.session_id
      INNER JOIN users u ON u.id = ss.user_id
      ${SESSION_SOURCE_JOIN}
      ORDER BY q.created_at DESC
      LIMIT ? OFFSET ?
    `,
    args: [limit, offset],
  });

  const items = res.rows.map((r) => {
    let questionCount = 0;
    let firstQuestion: string | null = null;
    try {
      const qs = JSON.parse(String(r.questionsJson ?? "[]")) as {
        question?: string;
      }[];
      questionCount = Array.isArray(qs) ? qs.length : 0;
      firstQuestion = qs[0]?.question ?? null;
    } catch {
      /* ignore */
    }
    return {
      id: String(r.id),
      userEmail: rowStr(r.userEmail),
      userName: rowStr(r.userName),
      sessionId: String(r.sessionId),
      createdAt: tsToIso(r.createdAt),
      score: r.score == null ? null : Number(r.score),
      totalQuestions:
        r.totalQuestions == null ? questionCount : Number(r.totalQuestions),
      questionCount,
      preview: firstQuestion ? previewText(firstQuestion) : null,
      questionsJson: String(r.questionsJson ?? ""),
      reviewJson: r.reviewJson ? String(r.reviewJson) : null,
      source: sessionSourceFromRow(r as Record<string, unknown>, null),
    };
  });

  return { total, items, hasMore: offset + items.length < total };
}

async function fetchFlashcards(page: number, limit: number) {
  const offset = (page - 1) * limit;
  const countRes = await db.$client.execute(
    "SELECT count(*) AS n FROM flashcards"
  );
  const total = Number(countRes.rows[0]?.n ?? 0);
  const res = await db.$client.execute({
    sql: `
      SELECT
        f.id,
        f.front,
        f.back,
        f.page_number AS pageNumber,
        f.srs_state AS srsState,
        f.created_at AS createdAt,
        u.email AS userEmail,
        u.name AS userName,
        ss.id AS sessionId,
        tc.title AS catalogTitle,
        d.title AS documentTitle,
        tc.id AS catalogId,
        d.id AS documentId,
        tc.chapter_page_ranges AS catalogRangesJson,
        d.chapter_page_ranges AS documentRangesJson,
        ss.document_json AS documentJson
      FROM flashcards f
      INNER JOIN study_sessions ss ON ss.id = f.session_id
      INNER JOIN users u ON u.id = ss.user_id
      ${SESSION_SOURCE_JOIN}
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `,
    args: [limit, offset],
  });

  const items = res.rows.map((r) => {
    const pageNum = r.pageNumber == null ? null : Number(r.pageNumber);
    return {
      id: String(r.id),
      userEmail: rowStr(r.userEmail),
      userName: rowStr(r.userName),
      sessionId: String(r.sessionId),
      createdAt: tsToIso(r.createdAt),
      front: String(r.front ?? ""),
      back: String(r.back ?? ""),
      srsState: Number(r.srsState ?? 0),
      source: sessionSourceFromRow(r as Record<string, unknown>, pageNum),
    };
  });

  return { total, items, hasMore: offset + items.length < total };
}

async function fetchVelocityGames(page: number, limit: number) {
  const offset = (page - 1) * limit;
  const countRes = await db.$client.execute(
    "SELECT count(*) AS n FROM velocity_games"
  );
  const total = Number(countRes.rows[0]?.n ?? 0);
  const res = await db.$client.execute({
    sql: `
      SELECT
        vg.id,
        vg.questions_json AS questionsJson,
        vg.results_json AS resultsJson,
        vg.review_json AS reviewJson,
        vg.accuracy,
        vg.avg_reaction_ms AS avgReactionMs,
        vg.created_at AS createdAt,
        u.email AS userEmail,
        u.name AS userName,
        ss.id AS sessionId,
        tc.title AS catalogTitle,
        d.title AS documentTitle,
        tc.id AS catalogId,
        d.id AS documentId,
        tc.chapter_page_ranges AS catalogRangesJson,
        d.chapter_page_ranges AS documentRangesJson,
        ss.document_json AS documentJson
      FROM velocity_games vg
      INNER JOIN study_sessions ss ON ss.id = vg.session_id
      INNER JOIN users u ON u.id = ss.user_id
      ${SESSION_SOURCE_JOIN}
      ORDER BY vg.created_at DESC
      LIMIT ? OFFSET ?
    `,
    args: [limit, offset],
  });

  const items = res.rows.map((r) => {
    let questionCount = 0;
    try {
      const qs = JSON.parse(String(r.questionsJson ?? "[]"));
      questionCount = Array.isArray(qs) ? qs.length : 0;
    } catch {
      /* ignore */
    }
    let growthAreas: string[] = [];
    try {
      if (r.reviewJson) {
        const rev = JSON.parse(String(r.reviewJson)) as {
          growthAreas?: string[];
        };
        growthAreas = Array.isArray(rev.growthAreas) ? rev.growthAreas : [];
      }
    } catch {
      /* ignore */
    }
    return {
      id: String(r.id),
      userEmail: rowStr(r.userEmail),
      userName: rowStr(r.userName),
      sessionId: String(r.sessionId),
      createdAt: tsToIso(r.createdAt),
      accuracy: r.accuracy == null ? null : Number(r.accuracy),
      avgReactionMs:
        r.avgReactionMs == null ? null : Number(r.avgReactionMs),
      questionCount,
      growthAreas,
      questionsJson: String(r.questionsJson ?? ""),
      resultsJson: r.resultsJson ? String(r.resultsJson) : null,
      reviewJson: r.reviewJson ? String(r.reviewJson) : null,
      source: sessionSourceFromRow(r as Record<string, unknown>, null),
    };
  });

  return { total, items, hasMore: offset + items.length < total };
}

async function fetchVelocityBank(page: number, limit: number) {
  const offset = (page - 1) * limit;
  const countRes = await db.$client.execute(
    "SELECT count(*) AS n FROM velocity_question_bank"
  );
  const total = Number(countRes.rows[0]?.n ?? 0);
  const res = await db.$client.execute({
    sql: `
      SELECT
        vqb.id,
        vqb.source_key AS sourceKey,
        vqb.page_index AS pageIndex,
        vqb.topic,
        vqb.type,
        vqb.question_json AS questionJson,
        vqb.report_count AS reportCount,
        vqb.created_at AS createdAt,
        u.email AS creatorEmail,
        u.name AS creatorName,
        tc.title AS catalogTitle,
        d.title AS documentTitle,
        tc.chapter_page_ranges AS catalogRangesJson,
        d.chapter_page_ranges AS documentRangesJson
      FROM velocity_question_bank vqb
      LEFT JOIN users u ON u.id = vqb.created_by
      LEFT JOIN textbook_catalog tc ON vqb.source_key = 'textbook:' || tc.id
      LEFT JOIN documents d ON vqb.source_key = 'doc:' || d.id
      ORDER BY vqb.created_at DESC
      LIMIT ? OFFSET ?
    `,
    args: [limit, offset],
  });

  const items = res.rows.map((r) => {
    const pageIndex = Number(r.pageIndex ?? 0);
    const sourceKey = String(r.sourceKey ?? "");
    let questionPreview: string | null = null;
    try {
      const q = JSON.parse(String(r.questionJson ?? "{}")) as {
        question?: string;
        prompt?: string;
      };
      questionPreview = q.question ?? q.prompt ?? null;
    } catch {
      /* ignore */
    }
    return {
      id: String(r.id),
      sourceKey,
      topic: rowStr(r.topic),
      type: String(r.type ?? ""),
      reportCount: Number(r.reportCount ?? 0),
      createdAt: tsToIso(r.createdAt),
      creatorEmail: rowStr(r.creatorEmail),
      creatorName: rowStr(r.creatorName),
      preview: questionPreview ? previewText(questionPreview) : null,
      questionJson: String(r.questionJson ?? ""),
      source: resolveSourceFromVelocityBank(
        sourceKey,
        rowStr(r.catalogTitle),
        rowStr(r.documentTitle),
        rowStr(r.catalogRangesJson),
        rowStr(r.documentRangesJson),
        pageIndex
      ),
    };
  });

  return { total, items, hasMore: offset + items.length < total };
}

export async function GET(request: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);

    if (searchParams.get("counts") === "1") {
      const counts = await fetchCounts();
      return NextResponse.json({ counts });
    }

    const section = searchParams.get("section");
    if (!section || !isValidContentSection(section)) {
      return NextResponse.json(
        {
          error: "Invalid section",
          sections: AI_STORED_CONTENT_SECTIONS.map((s) => s.id),
        },
        { status: 400 }
      );
    }

    const page = Math.max(
      1,
      parseInt(searchParams.get("page") ?? "1", 10) || 1
    );
    const limit = Math.min(
      MAX_CONTENT_PAGE_SIZE,
      Math.max(
        1,
        parseInt(
          searchParams.get("limit") ?? String(DEFAULT_CONTENT_PAGE_SIZE),
          10
        ) || DEFAULT_CONTENT_PAGE_SIZE
      )
    );

    const notesType = (searchParams.get("notesType") ?? "all") as
      | "session"
      | "public"
      | "all";
    const safeNotesType =
      notesType === "session" || notesType === "public" ? notesType : "all";

    let result: { total: number; items: unknown[]; hasMore: boolean };
    switch (section) {
      case "notes":
        result = await fetchNotes(safeNotesType, page, limit);
        break;
      case "quiz":
        result = await fetchQuiz(page, limit);
        break;
      case "flashcards":
        result = await fetchFlashcards(page, limit);
        break;
      case "velocity-games":
        result = await fetchVelocityGames(page, limit);
        break;
      case "velocity-bank":
        result = await fetchVelocityBank(page, limit);
        break;
    }

    return NextResponse.json({
      section,
      notesType: section === "notes" ? safeNotesType : undefined,
      total: result.total,
      page,
      hasMore: result.hasMore,
      items: result.items,
    });
  } catch (err) {
    console.error("[admin/ai-content]", err);
    return NextResponse.json(
      { error: "Failed to load AI content" },
      { status: 500 }
    );
  }
}
