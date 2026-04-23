import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getAppUser } from "@/lib/app-user";
import { openai, MODEL, isAiConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { clientErrorLogs } from "@/lib/db/schema";
import { isShortAnswerCorrect } from "@/lib/velocity-match";

const bodySchema = z.object({
  question: z.string().min(1).max(2000),
  correctAnswer: z.string().min(1).max(500),
  userAnswer: z.string().max(500),
  topic: z.string().max(200).optional(),
});

const gradeSchema = z.object({
  correct: z.boolean(),
  reason: z.string(),
});

async function logServerFailure(userId: string | null, email: string | null, err: unknown, extra?: unknown) {
  const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
  const stack = err instanceof Error ? err.stack ?? null : null;
  let extraJson: string | null = null;
  try {
    extraJson = extra != null ? JSON.stringify(extra).slice(0, 16000) : null;
  } catch {}
  try {
    await db.insert(clientErrorLogs).values({
      id: crypto.randomUUID(),
      createdAt: new Date(),
      kind: "dev",
      userId,
      email,
      message: `[velocity/grade] ${message}`.slice(0, 4000),
      stack: stack?.slice(0, 32000) ?? null,
      url: null,
      userAgent: null,
      extra: extraJson,
    });
  } catch {
    /* logging must never throw */
  }
}

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { question, correctAnswer, userAnswer, topic } = parsed.data;

  const trimmed = userAnswer.trim();
  if (!trimmed) {
    return NextResponse.json({
      correct: false,
      reason: "No answer provided.",
      source: "local",
    });
  }

  // Fast path — obvious typo-tolerant exact match (never over-accepts, just catches
  // clean hits without a round-trip to the AI).
  if (isShortAnswerCorrect(trimmed, correctAnswer)) {
    return NextResponse.json({
      correct: true,
      reason: "Matches the canonical answer.",
      source: "local",
    });
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI grader not configured" },
      { status: 503 }
    );
  }

  const system = `You are grading a short-answer reaction quiz question (NSB / quiz-bowl style).

Decide whether the user's answer should be accepted against the canonical correct answer. Err on the side of acceptance when the user clearly identified the same thing — this is a fast reaction game, not a spelling bee.

ACCEPT when:
- The user's answer means the same thing as the canonical answer (synonyms, common names vs. scientific names, alternate casing/spelling, minor typos).
- The user's answer contains the canonical answer plus extra but still-correct qualifying words.
- A numeric answer matches the canonical number (allow equivalent forms like "1/2" vs "0.5", "3.5" vs "3 1/2", "5 sqrt(6)" vs "5√6").
- The user's answer names the same specific entity (e.g. "parabola" and "parabolic" for "parabola (ACCEPT: parabolic)").
- The user wrote the **spoken name of a Greek letter, symbol, constant, or formula** when the canonical answer is the symbol itself (or vice versa). Examples that MUST be accepted:
  - "chi" ↔ "χ" ↔ "x" (when x is being used as the Greek chi, e.g. mole fraction)
  - "pi" ↔ "π"
  - "delta" ↔ "Δ" ↔ "δ"
  - "mu" ↔ "μ", "rho" ↔ "ρ", "sigma" ↔ "Σ" / "σ", "phi" ↔ "φ", "theta" ↔ "θ", "lambda" ↔ "λ", "omega" ↔ "ω", "gamma" ↔ "γ", "beta" ↔ "β", "alpha" ↔ "α", "epsilon" ↔ "ε", "tau" ↔ "τ", "psi" ↔ "ψ", "eta" ↔ "η", "nu" ↔ "ν", "kappa" ↔ "κ", "zeta" ↔ "ζ", "iota" ↔ "ι", "xi" ↔ "ξ", "upsilon" ↔ "υ", "omicron" ↔ "ο"
  - "h-bar" / "hbar" ↔ "ℏ", "planck's constant" ↔ "h"
  - "avogadro" / "avogadro's number" ↔ "NA" / "6.022e23"
- Treat a symbol and its spoken name as interchangeable whenever the question is asking for that symbol. Do NOT reject a Greek-letter name on the grounds that "the canonical answer is the letter, not the name".
- The user gave a MORE specific, textbook-accurate name for the same phenomenon the canonical answer describes in general terms, and that specific name is the one most experts / textbooks would actually use for the scenario in the question. Example: question asks what process in a lead-acid battery produces H₂ and O₂, canonical answer "decomposition", user answered "electrolysis" — ACCEPT: electrolysis IS the specific process and is a strictly better answer.
- The user gave a widely-accepted alternate name (e.g. "Krebs cycle" ↔ "citric acid cycle" ↔ "TCA cycle", "mitosis" ↔ "karyokinesis", "sodium chloride" ↔ "table salt").
- The user gave a **well-known abbreviation, acronym, or initialism** that unambiguously refers to the canonical answer (or vice versa — user wrote the expansion when the canonical is the acronym). Always accept both directions. Examples that MUST be accepted:
  - "CMB" ↔ "cosmic microwave background" (also "CMBR" ↔ "cosmic microwave background radiation")
  - "DNA" ↔ "deoxyribonucleic acid", "RNA" ↔ "ribonucleic acid", "mRNA" ↔ "messenger RNA"
  - "ATP" ↔ "adenosine triphosphate", "ADP" ↔ "adenosine diphosphate", "NAD⁺" / "NADH" ↔ "nicotinamide adenine dinucleotide"
  - "LHC" ↔ "Large Hadron Collider", "CERN" ↔ "European Organization for Nuclear Research"
  - "HIV" ↔ "human immunodeficiency virus", "AIDS" ↔ "acquired immunodeficiency syndrome", "COVID" ↔ "coronavirus disease"
  - "WWII" ↔ "World War II", "NATO" ↔ "North Atlantic Treaty Organization", "UN" ↔ "United Nations"
  - "PCR" ↔ "polymerase chain reaction", "CRISPR" ↔ (treat as the acronym itself)
  - "GDP" ↔ "gross domestic product", "CPU" ↔ "central processing unit"
  - Chemical / SI symbols and element symbols where the question clearly asks for the named thing: "NaCl" ↔ "sodium chloride", "Fe" ↔ "iron", "H₂O" ↔ "water"
- When unsure whether an abbreviation is standard for the canonical answer, accept it as long as it would be the FIRST thing an expert writes on scratch paper for that concept.

REJECT when:
- The user's answer refers to a different concept, organ, organism, element, mechanism, etc.
- A key distinguishing word is missing (e.g. "microwave background" is wrong for "cosmic microwave background" because "cosmic" is the distinguishing word).
- The user's answer contains the right general category but the wrong specific item.
- The user's answer is too vague or generic to uniquely identify the canonical answer.

Return a boolean "correct" and a ONE short sentence "reason" explaining the decision in plain language (no preamble).`;

  try {
    const { object } = await generateObject({
      model: openai(MODEL),
      schema: gradeSchema,
      system,
      prompt: `Question: ${question}
Canonical correct answer: ${correctAnswer}${topic ? `\nTopic: ${topic}` : ""}
User's answer: ${trimmed}

Is the user's answer acceptable?`,
    });
    return NextResponse.json({ ...object, source: "ai" });
  } catch (err) {
    await logServerFailure(user.id, user.email ?? null, err, {
      route: "POST /api/ai/velocity/grade",
      correctAnswer,
      userAnswer: trimmed,
    });
    // Fall back to strict local result (which we already know is false here)
    return NextResponse.json({
      correct: false,
      reason: "Grader unavailable — accepted only exact matches.",
      source: "fallback",
    });
  }
}
