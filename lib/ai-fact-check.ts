/**
 * AI fact-checking pass for auto-generated questions.
 *
 * The Quiz and Velocity generators occasionally produce questions where the
 * marked correct answer doesn't match the source text — wrong constant value,
 * a "not the most specific name" canonical, two equally correct MC options,
 * or a stem that asks about something not in the reading at all.
 *
 * After generation we run the questions through this verifier, which sees the
 * source text, decides per-question whether to keep / fix / drop, and returns
 * the corrected list. Fixes are applied in-place; drops shrink the count.
 *
 * For Velocity (toss-up / bonus pairs), we drop both halves of a pair if
 * either side is unfixable — otherwise the pair structure breaks.
 *
 * The grader self-check is a separate, smaller call that double-checks a
 * "wrong" verdict before scoring. If the second pass disagrees, we flip
 * the verdict to "correct" — covers cases where the first grader missed an
 * abbreviation, synonym, or more-specific name the user wrote.
 */
import { generateObject } from "ai";
import { z } from "zod";
import {
  openai,
  MODEL,
  isAiConfigured,
  wrapUntrusted,
  UNTRUSTED_INPUT_GUARD,
} from "@/lib/ai";
import type { AiUsageShape } from "@/lib/ai-usage";

/** Per-question fact-check verdict. Flat schema (no oneOf) so OpenAI
 *  structured outputs accepts it. Replacement fields are always present;
 *  callers ignore them when verdict === "ok" or "drop". */
const verdictSchema = z.object({
  index: z.number().int().min(0),
  verdict: z.enum(["ok", "fix", "drop"]),
  reason: z.string(),
  /** Replacement question stem (used when verdict = "fix"). Echo input
   *  otherwise. */
  fixedQuestion: z.string(),
  /** Replacement MC options (4 entries). For SA questions, callers ignore
   *  this. Echo input otherwise. */
  fixedOptions: z.array(z.string()).length(4),
  /** Replacement MC correct index. Echo input otherwise. */
  fixedCorrectIndex: z.number().int().min(0).max(3),
  /** Replacement SA canonical answer. Echo input otherwise. */
  fixedAnswer: z.string(),
  /** Replacement explanation. Echo input otherwise. */
  fixedExplanation: z.string(),
});

const factCheckResponseSchema = z.object({
  results: z.array(verdictSchema),
});

const VERIFIER_BASE_SYSTEM = `You are fact-checking auto-generated study questions against a textbook reading.

For each question in the input array, decide:
1. Is the question itself accurate? (the formula, law, definition, or relationship it references must match the source)
2. Is the marked correct answer actually correct per the source?
3. For multiple-choice: are the distractors all clearly wrong? (no "two equally correct" issue)
4. Is the explanation accurate?

VERDICTS:
- "ok": question, answer, options, and explanation are all correct per the source. Echo every "fixed*" field with the original input verbatim.
- "fix": the question is *salvageable* — you can correct the wrong piece (rewrite the stem, swap which option is correct, change the canonical SA answer to the actually-correct value, fix a wrong explanation, replace one bad MC distractor) without changing the underlying topic. Fill the "fixed*" fields with the corrected versions. Always provide ALL fixed* fields, even ones you didn't change (echo the original).
- "drop": the question is unsalvageable — the concept isn't in the source at all, the question is multi-part / nonsensical, or there's no clearly correct answer among the four MC options. Echo the "fixed*" fields with the originals (the caller will discard them anyway).

CALIBRATION:
- Be strict but FAIR. Don't drop a question just because the wording is slightly imperfect — only when it's actually wrong. If the source supports the concept and the answer is correct, return "ok".
- Prefer "fix" over "drop" when the question is *almost* right (e.g. correctIndex points at the wrong option but one of the other three is clearly correct → swap correctIndex).
- For SA: if the canonical answer is a generic parent category when a specific named term exists in the source (e.g. "decomposition" when the source says "electrolysis"), use "fix" with the more-specific answer.
- Universal scientific facts (speed of light, freezing point of water, the value of NA, the formula PV=nRT, etc.) are correct even if the *specific source* doesn't restate them. Don't drop a question on PV=nRT just because it's a chemistry chapter — verify the formula and answer are physically/chemically correct.

OUTPUT:
- Return one verdict per input question, in the same order. The "index" field should match the input's array position (0-based).
- "reason" is one short sentence. It's used in dev logs, never shown to the user — be specific ("MC says option 2 is correct, but option 0 is the actual van der Waals correction term").
- ALWAYS include all fixed* fields on every verdict (even "ok" and "drop"). When in doubt, echo the original.`;

/** Quiz question shape used by the verifier (matches `/api/ai/quiz` schema). */
export interface QuizQuestionDraft {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

/**
 * Fact-check a list of quiz (MC-only) questions. Returns the corrected list
 * with drops removed and fixes applied. If the verifier fails, the original
 * list is returned unchanged so we never block on a broken verifier.
 */
export async function factCheckQuizQuestions(
  questions: QuizQuestionDraft[],
  sourceText: string,
  ownerExtra: string
): Promise<{
  verified: QuizQuestionDraft[];
  dropped: number;
  fixed: number;
  usage?: AiUsageShape;
}> {
  if (!isAiConfigured() || questions.length === 0) {
    return { verified: questions, dropped: 0, fixed: 0 };
  }

  const compactInput = questions.map((q, i) => ({
    index: i,
    type: "mc" as const,
    question: q.question,
    options: q.options,
    correctIndex: q.correctIndex,
    answer: q.options[q.correctIndex] ?? "",
    explanation: q.explanation,
  }));

  try {
    const { object, usage } = await generateObject({
      model: openai(MODEL),
      schema: factCheckResponseSchema,
      system:
        VERIFIER_BASE_SYSTEM +
        (ownerExtra ? `\n\n${ownerExtra}` : "") +
        UNTRUSTED_INPUT_GUARD,
      prompt: `Source reading material:\n\n${wrapUntrusted(
        "reading material",
        sourceText.slice(0, 12_000)
      )}\n\nQuestions to fact-check (JSON):\n${JSON.stringify(
        compactInput,
        null,
        2
      )}\n\nReturn one verdict per question, in input order.`,
    });

    let dropped = 0;
    let fixed = 0;
    const byIndex = new Map<number, z.infer<typeof verdictSchema>>();
    for (const v of object.results) byIndex.set(v.index, v);

    const verified: QuizQuestionDraft[] = [];
    for (let i = 0; i < questions.length; i++) {
      const v = byIndex.get(i);
      const original = questions[i];
      if (!v) {
        // Verifier didn't return a verdict for this slot — keep the original.
        verified.push(original);
        continue;
      }
      if (v.verdict === "drop") {
        dropped += 1;
        continue;
      }
      if (v.verdict === "fix") {
        fixed += 1;
        verified.push({
          question: v.fixedQuestion || original.question,
          options:
            Array.isArray(v.fixedOptions) && v.fixedOptions.length === 4
              ? v.fixedOptions
              : original.options,
          correctIndex:
            v.fixedCorrectIndex >= 0 && v.fixedCorrectIndex <= 3
              ? v.fixedCorrectIndex
              : original.correctIndex,
          explanation: v.fixedExplanation || original.explanation,
        });
        continue;
      }
      verified.push(original);
    }

    return { verified, dropped, fixed, usage };
  } catch (e) {
    console.warn(
      "[ai-fact-check] quiz verifier failed, returning unchanged:",
      (e as Error).message
    );
    return { verified: questions, dropped: 0, fixed: 0 };
  }
}

/** Velocity question shape used by the verifier (matches the flat schema in
 *  `/api/ai/velocity`). MC options/correctIndex and SA answer/acceptedAnswers
 *  always coexist so there's a single shape regardless of question type. */
export interface VelocityQuestionDraft {
  type: "mc" | "sa";
  roundType: "tossup" | "bonus";
  pairId: string;
  question: string;
  options: [string, string, string, string];
  correctIndex: number;
  answer: string;
  acceptedAnswers: string[];
  topic: string;
  explanation: string;
  pageIndex: number;
}

/**
 * Fact-check Velocity questions. Pairs (consecutive tossup + bonus sharing a
 * pairId) are atomic — if either half is dropped, both halves are dropped so
 * the pair structure stays valid.
 *
 * Input order MUST be tossup-then-bonus per pair, which matches what the
 * generator already produces.
 */
export async function factCheckVelocityQuestions(
  questions: VelocityQuestionDraft[],
  sourceText: string,
  ownerExtra: string
): Promise<{
  verified: VelocityQuestionDraft[];
  dropped: number;
  fixed: number;
  usage?: AiUsageShape;
}> {
  if (!isAiConfigured() || questions.length === 0) {
    return { verified: questions, dropped: 0, fixed: 0 };
  }

  const compactInput = questions.map((q, i) => ({
    index: i,
    type: q.type,
    roundType: q.roundType,
    pairId: q.pairId,
    topic: q.topic,
    question: q.question,
    options: q.options,
    correctIndex: q.correctIndex,
    answer: q.answer,
    acceptedAnswers: q.acceptedAnswers,
    explanation: q.explanation,
  }));

  try {
    const { object, usage } = await generateObject({
      model: openai(MODEL),
      schema: factCheckResponseSchema,
      system:
        VERIFIER_BASE_SYSTEM +
        `\n\nThis is a Velocity (NSB-style toss-up/bonus) question set. Pairs of consecutive items share a "pairId"; the toss-up tests recognition and the bonus tests application of the same concept. Verify each independently — the caller will drop both halves of a pair if either side is unfixable.` +
        (ownerExtra ? `\n\n${ownerExtra}` : "") +
        UNTRUSTED_INPUT_GUARD,
      prompt: `Source reading material:\n\n${wrapUntrusted(
        "reading material",
        sourceText.slice(0, 12_000)
      )}\n\nQuestions to fact-check (JSON):\n${JSON.stringify(
        compactInput,
        null,
        2
      )}\n\nReturn one verdict per question, in input order.`,
    });

    let dropped = 0;
    let fixed = 0;
    const byIndex = new Map<number, z.infer<typeof verdictSchema>>();
    for (const v of object.results) byIndex.set(v.index, v);

    const droppedIndices = new Set<number>();
    const fixedQuestions: VelocityQuestionDraft[] = questions.map((q, i) => {
      const v = byIndex.get(i);
      if (!v) return q;
      if (v.verdict === "drop") {
        droppedIndices.add(i);
        return q;
      }
      if (v.verdict === "fix") {
        fixed += 1;
        if (q.type === "mc") {
          return {
            ...q,
            question: v.fixedQuestion || q.question,
            options:
              Array.isArray(v.fixedOptions) && v.fixedOptions.length === 4
                ? (v.fixedOptions as [string, string, string, string])
                : q.options,
            correctIndex:
              v.fixedCorrectIndex >= 0 && v.fixedCorrectIndex <= 3
                ? v.fixedCorrectIndex
                : q.correctIndex,
            answer: v.fixedAnswer || q.answer,
            explanation: v.fixedExplanation || q.explanation,
          };
        }
        return {
          ...q,
          question: v.fixedQuestion || q.question,
          answer: v.fixedAnswer || q.answer,
          explanation: v.fixedExplanation || q.explanation,
        };
      }
      return q;
    });

    // Pair atomicity: if either half of a pair is dropped, drop both.
    // Pairs are consecutive (tossup at even index, bonus at odd index)
    // and share a pairId. We use index parity since the generator
    // outputs strict tossup→bonus alternation.
    for (let i = 0; i < fixedQuestions.length; i += 2) {
      const left = i;
      const right = i + 1;
      if (right >= fixedQuestions.length) break;
      if (droppedIndices.has(left) || droppedIndices.has(right)) {
        droppedIndices.add(left);
        droppedIndices.add(right);
      }
    }

    const verified: VelocityQuestionDraft[] = [];
    for (let i = 0; i < fixedQuestions.length; i++) {
      if (droppedIndices.has(i)) {
        dropped += 1;
        continue;
      }
      verified.push(fixedQuestions[i]);
    }

    return { verified, dropped, fixed, usage };
  } catch (e) {
    console.warn(
      "[ai-fact-check] velocity verifier failed, returning unchanged:",
      (e as Error).message
    );
    return { verified: questions, dropped: 0, fixed: 0 };
  }
}

/** Self-check schema for the SA grader's second pass. */
const selfCheckSchema = z.object({
  reallyWrong: z.boolean(),
  reason: z.string(),
});

/**
 * Second-pass review of an SA "wrong" verdict. Returns `null` if the
 * self-check fails (caller should keep the original verdict).
 *
 * The first grader already saw a generous accept-list. This pass is one more
 * fresh look at *just* the user's answer vs. the canonical answer, with no
 * prior context that might bias toward a quick rejection.
 */
export async function selfCheckGraderVerdict(args: {
  question: string;
  correctAnswer: string;
  userAnswer: string;
  acceptedAnswers?: string[];
  initialReason: string;
}): Promise<{ reallyWrong: boolean; reason: string; usage?: AiUsageShape } | null> {
  if (!isAiConfigured()) return null;

  const system = `You are an independent second grader reviewing a "WRONG" verdict from another grader. Your only job: determine whether the first grader was right to reject the user's answer, or whether they missed something that should have been accepted.

Re-read the question, the canonical answer, and the user's answer. Use these acceptance rules:
- ACCEPT if the user's answer means the same thing (synonym, common name, alternate spelling, minor typo, morphological variant of the same root word).
- ACCEPT if the user wrote a well-known abbreviation/acronym/expansion of the canonical (or vice versa). E.g. "CMB" ↔ "cosmic microwave background", "DNA" ↔ "deoxyribonucleic acid".
- ACCEPT if the user wrote the spoken name of a Greek letter / symbol when the canonical is the symbol (e.g. "chi" ↔ "χ", "pi" ↔ "π").
- ACCEPT if the user gave a more-specific textbook-accurate name for the same phenomenon (e.g. "electrolysis" when canonical was "decomposition" — electrolysis IS the specific process).
- ACCEPT if the user matched a common alternate name (e.g. "Krebs cycle" ↔ "citric acid cycle", "table salt" ↔ "sodium chloride").
- REJECT if the user named a different concept, was missing a distinguishing word, or was too generic to identify the canonical uniquely.

Output:
- "reallyWrong" = true if the original "WRONG" verdict was correct (the user genuinely missed it).
- "reallyWrong" = false if you would have accepted the user's answer (flips the verdict to correct).
- "reason" = one short sentence explaining your conclusion, plain language. If you flip the verdict, name the specific acceptance rule that applies (e.g. "spoken Greek-letter name of the symbol χ", "more-specific textbook term electrolysis").`;

  try {
    const { object, usage } = await generateObject({
      model: openai(MODEL),
      schema: selfCheckSchema,
      system: system + UNTRUSTED_INPUT_GUARD,
      prompt: `Question: ${args.question}
Canonical correct answer: ${args.correctAnswer}${
        args.acceptedAnswers && args.acceptedAnswers.length > 0
          ? `\nAlso explicitly accepted: ${args.acceptedAnswers.join(", ")}`
          : ""
      }
First grader's reasoning (already returned WRONG): ${args.initialReason}

${wrapUntrusted("user answer", args.userAnswer)}

Was the first grader right to reject this? Return reallyWrong=true to confirm wrong, or reallyWrong=false to flip to correct.`,
    });
    return { reallyWrong: object.reallyWrong, reason: object.reason, usage };
  } catch (e) {
    console.warn(
      "[ai-fact-check] grader self-check failed:",
      (e as Error).message
    );
    return null;
  }
}
