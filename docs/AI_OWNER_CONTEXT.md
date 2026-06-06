# Bowl Beacon — Owner AI context

This document is injected into the **Owner AI copilot** so the super-owner can reason about product behavior and refine runtime AI settings without reading the full architecture doc.

For full system design see `docs/ARCHITECTURE.md`.

---

## Product summary

**Bowl Beacon** is a Next.js study app. Students sign in, open catalog textbooks or uploaded PDFs, run **focused study sessions** (timers, page tracking, anti-distraction UX), and use AI for:

- **Notes** per page
- **Quiz** from accumulated reading
- **Flashcards** from session notes
- **Velocity** reaction-speed game (toss-up/bonus pairs)
- **Video suggestions** after a session
- **Spaced repetition** review (`/review`) for flashcards

Files live on **Cloudflare R2**; metadata in **Turso/SQLite** via Drizzle.

---

## AI features and persistence

| Feature | Route | Stored where | Cache / reuse |
|---------|-------|--------------|---------------|
| Notes | `POST /api/ai/notes` | `ai_notes` (per session) | `public_notes` (catalog page), `document_notes` (upload page) |
| Quiz | `POST /api/ai/quiz` | `quizzes.questions_json` | `document_quiz_questions` for uploads |
| Flashcards | `POST /api/ai/flashcards` | `flashcards` | Reuse by `document_id` + page overlap |
| Velocity | `POST /api/ai/velocity` | `velocity_games` | `velocity_question_bank` by source + page |
| Videos | `POST /api/ai/videos` | `study_sessions.videos_json` | Per session |
| Quiz review | `POST /api/ai/quiz/review` | `quizzes.review_json` | After quiz completion |

**Notes cache flow:** On cache hit, content is copied into `ai_notes` for that session (no AI call). Cache miss → OpenAI → save session copy + upsert shared cache.

**Prompt versions:** `PUBLIC_NOTE_PROMPT_VERSION` and `DOCUMENT_NOTE_PROMPT_VERSION` in `app/api/ai/notes/route.ts` invalidate old cache rows when **code** changes the base prompt. Bumping those requires a deploy; owner settings do not auto-bump versions.

---

## Owner-editable vs code-owned

### Owner-editable (no deploy) — `app_settings` keys

| Key | Effect |
|-----|--------|
| `ai_product_context` | Prepended to all student-facing AI system prompts |
| `ai_owner_style` | Global style append on all features |
| `ai_notes_extra` | Notes generation only |
| `ai_quiz_extra` | Quiz generation + fact-check |
| `ai_flashcards_extra` | Flashcard generation |
| `ai_velocity_extra` | Velocity generate, complete, fact-check |
| `ai_videos_extra` | Video topic selection |

Edited via **Admin → Owner AI** or applied from copilot proposals.

### Code-owned (deploy required)

- Base `BASE_SYSTEM` strings in each `app/api/ai/**/route.ts`
- Zod schemas, fact-check logic (`lib/ai-fact-check.ts`)
- Coverage checklists (quiz/velocity), token limits, model id (`lib/ai.ts` `MODEL`)
- Cache prompt version integers

---

## Admin moderation (AI Content tab)

Super-owner/admins browse persisted AI artifacts:

- **Notes:** session copies vs public/document cache. × on cache invalidates shared row; session copies kept.
- **Quiz:** individual questions (flattened from quiz JSON). × removes one question.
- **Flashcards, velocity games, velocity bank:** × hard-deletes row.

Right-click edits content in place. Use this to fix bad outputs; use Owner AI settings to change future generation behavior.

---

## Fact-checking

Quiz and Velocity generation run through `factCheckQuizQuestions` / `factCheckVelocityQuestions` after the model returns structured output. Verifier can fix, drop, or pass questions. Owner `ai_quiz_extra` / `ai_velocity_extra` are passed into the verifier system prompt.

---

## Token usage

All AI routes call `recordAiUsage`. Per-user caps via `ai_token_limit`; super-owner uncapped. Admin **Users → AI usage** shows input/output text per call.

---

## Copilot proposal format

When suggesting settings changes, output a JSON block the UI can parse:

```json
{"type":"owner_ai_proposal","patches":{"ai_owner_style":"...","ai_quiz_extra":"..."},"summary":"One-line description"}
```

Allowed patch keys: `ai_product_context`, `ai_owner_style`, `ai_notes_extra`, `ai_quiz_extra`, `ai_flashcards_extra`, `ai_velocity_extra`, `ai_videos_extra`.

The owner must click **Apply** in the UI; nothing applies automatically.

---

## Refinement playbook

1. **Tone/depth/format** → adjust `ai_owner_style` or per-feature extras.
2. **Subject-specific pedagogy** (e.g. always define variables on formula cards) → `ai_flashcards_extra` or global style.
3. **Bad cached notes on a textbook page** → AI Content → Public notes → × invalidate; or bump prompt version in code.
4. **Structural behavior** (coverage rules, schemas) → code change in Cursor + deploy.
