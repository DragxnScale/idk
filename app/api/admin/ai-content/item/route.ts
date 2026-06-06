import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import {
  aiNotes,
  documentNotes,
  flashcards,
  publicNotes,
  quizzes,
  velocityQuestionBank,
} from "@/lib/db/schema";
import type { AiStoredContentSectionId } from "@/lib/ai-stored-content-sections";

export const runtime = "nodejs";

interface PatchBody {
  section: AiStoredContentSectionId;
  id: string;
  kind?: "session" | "public" | "document";
  patch: Record<string, unknown>;
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as PatchBody;
    const { section, id, kind, patch } = body;

    if (!section || !id || !patch) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    if (section === "notes") {
      const content = patch.content;
      if (typeof content !== "string" || !content.trim()) {
        return NextResponse.json({ error: "Invalid content" }, { status: 400 });
      }
      const noteKind = kind ?? "session";
      if (noteKind === "public") {
        const row = await db.query.publicNotes.findFirst({
          where: eq(publicNotes.id, id),
        });
        if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
        await db
          .update(publicNotes)
          .set({ content: content.trim(), updatedAt: new Date() })
          .where(eq(publicNotes.id, id));
      } else if (noteKind === "document") {
        const row = await db.query.documentNotes.findFirst({
          where: eq(documentNotes.id, id),
        });
        if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
        await db
          .update(documentNotes)
          .set({ content: content.trim(), updatedAt: new Date() })
          .where(eq(documentNotes.id, id));
      } else {
        const row = await db.query.aiNotes.findFirst({
          where: eq(aiNotes.id, id),
        });
        if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
        await db
          .update(aiNotes)
          .set({ content: content.trim() })
          .where(eq(aiNotes.id, id));
      }
      return NextResponse.json({ ok: true, content: content.trim() });
    }

    if (section === "flashcards") {
      const front = patch.front;
      const back = patch.back;
      if (typeof front !== "string" || typeof back !== "string") {
        return NextResponse.json({ error: "Invalid front/back" }, { status: 400 });
      }
      const row = await db.query.flashcards.findFirst({
        where: eq(flashcards.id, id),
      });
      if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
      await db
        .update(flashcards)
        .set({ front: front.trim(), back: back.trim() })
        .where(eq(flashcards.id, id));
      return NextResponse.json({ ok: true, front: front.trim(), back: back.trim() });
    }

    if (section === "quiz") {
      const colon = id.indexOf(":");
      if (colon <= 0) {
        return NextResponse.json({ error: "Invalid quiz id" }, { status: 400 });
      }
      const quizId = id.slice(0, colon);
      const questionIndex = parseInt(id.slice(colon + 1), 10);
      if (!Number.isFinite(questionIndex) || questionIndex < 0) {
        return NextResponse.json({ error: "Invalid question index" }, { status: 400 });
      }

      const quiz = await db.query.quizzes.findFirst({
        where: eq(quizzes.id, quizId),
      });
      if (!quiz) return NextResponse.json({ error: "Not found" }, { status: 404 });

      let questions: Record<string, unknown>[];
      try {
        questions = JSON.parse(quiz.questionsJson) as Record<string, unknown>[];
      } catch {
        return NextResponse.json({ error: "Invalid quiz JSON" }, { status: 500 });
      }
      if (!Array.isArray(questions) || questionIndex >= questions.length) {
        return NextResponse.json({ error: "Question not found" }, { status: 404 });
      }

      const updated = {
        ...questions[questionIndex],
        ...(typeof patch.question === "string" ? { question: patch.question } : {}),
        ...(Array.isArray(patch.options) ? { options: patch.options } : {}),
        ...(typeof patch.correctIndex === "number"
          ? { correctIndex: patch.correctIndex }
          : {}),
        ...(typeof patch.explanation === "string"
          ? { explanation: patch.explanation }
          : {}),
      };
      questions[questionIndex] = updated;
      await db
        .update(quizzes)
        .set({ questionsJson: JSON.stringify(questions) })
        .where(eq(quizzes.id, quizId));
      return NextResponse.json({ ok: true, question: updated });
    }

    if (section === "velocity-bank") {
      const row = await db.query.velocityQuestionBank.findFirst({
        where: eq(velocityQuestionBank.id, id),
      });
      if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

      let questionObj: Record<string, unknown>;
      if (typeof patch.questionJson === "string") {
        try {
          questionObj = JSON.parse(patch.questionJson) as Record<string, unknown>;
        } catch {
          return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
        }
      } else {
        try {
          questionObj = JSON.parse(row.questionJson) as Record<string, unknown>;
        } catch {
          questionObj = {};
        }
        if (typeof patch.question === "string") questionObj.question = patch.question;
        if (Array.isArray(patch.options)) questionObj.options = patch.options;
        if (typeof patch.correctIndex === "number") {
          questionObj.correctIndex = patch.correctIndex;
        }
        if (typeof patch.explanation === "string") {
          questionObj.explanation = patch.explanation;
        }
      }

      const questionJson = JSON.stringify(questionObj);
      await db
        .update(velocityQuestionBank)
        .set({ questionJson })
        .where(eq(velocityQuestionBank.id, id));
      return NextResponse.json({ ok: true, questionJson });
    }

    return NextResponse.json({ error: "Section not editable" }, { status: 400 });
  } catch (err) {
    console.error("[admin/ai-content/item]", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
