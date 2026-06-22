import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";

// ── Auth tables (NextAuth v4 compatible) ─────────────────────────────

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash"),
  exitPasswordHash: text("exit_password_hash"),
  dailyMinutesGoal: integer("daily_minutes_goal"),
  dailySessionsGoal: integer("daily_sessions_goal"),
  inactivityTimeout: integer("inactivity_timeout"), // minutes, null = default (3)
  quizMinQuestions: integer("quiz_min_questions"), // null = default (3)
  quizMaxQuestions: integer("quiz_max_questions"), // null = default (10)
  defaultGoalType: text("default_goal_type"),       // "time" | "pages" | "chapter" | null
  defaultTargetValue: integer("default_target_value"), // default minutes/pages for new sessions
  pomodoroEnabled: integer("pomodoro_enabled", { mode: "boolean" }).default(false),
  pomodoroFocusMin: integer("pomodoro_focus_min"),    // default 25
  pomodoroBreakMin: integer("pomodoro_break_min"),    // default 5
  pomodoroLongBreakMin: integer("pomodoro_long_break_min"), // default 15
  pomodoroCycles: integer("pomodoro_cycles"),         // cycles before long break, default 4
  storageBytes: integer("storage_bytes").default(0),         // running total of user upload bytes
  storageQuotaBytes: integer("storage_quota_bytes"),         // null = use DEFAULT_QUOTA_BYTES
  aiTokensUsed: integer("ai_tokens_used").default(0),         // lifetime sum of prompt+completion tokens across every AI route
  aiTokenLimit: integer("ai_token_limit"),                    // null = use DEFAULT_AI_TOKEN_LIMIT from env / code
  themeId: text("theme_id"), // custom theme color set id
  image: text("image"),
  emailVerified: integer("email_verified", { mode: "timestamp" }),
  mutedUntil: integer("muted_until", { mode: "timestamp" }),
  isAdmin: integer("is_admin", { mode: "boolean" }).default(false),
  /**
   * "Super owner" flag — granted owner-level capabilities (manage admins,
   * use Owner AI chat, etc.) without depending on a hardcoded email match.
   * Set this to `true` on yourself in Turso so you can never lock yourself
   * out by losing access to the email used at signup. Multiple owners are
   * allowed; the email-based fallback (`SUPER_ADMIN_EMAIL` in lib/admin.ts)
   * still works as a safety net.
   */
  isOwner: integer("is_owner", { mode: "boolean" }).default(false),
  /**
   * Developer mode — gates extra in-app diagnostic surfaces (currently the
   * admin "Focused studying per page" panel under each session detail).
   * Editable from settings only when the row is also flagged `is_admin`
   * or `is_owner`. Keeps the surface area for risky internal panels off
   * by default even on staff accounts.
   */
  isDeveloper: integer("is_developer", { mode: "boolean" }).default(false),
  blocked: integer("blocked", { mode: "boolean" }).default(false),
  /**
   * Spaced-repetition pacing caps. Mirror Anki's defaults so users
   * coming from there don't get surprised. Both are SOFT caps applied
   * at queue-build time in `/api/review/queue` — the underlying card
   * schedule is unaffected. `null` falls back to defaults.
   */
  srsNewPerDay: integer("srs_new_per_day").default(20),
  srsReviewsPerDay: integer("srs_reviews_per_day").default(200),
  /** When true, manual session end runs Boss Beacons (cooldown + boss MC fights). */
  exitBossBeaconsEnabled: integer("exit_boss_beacons_enabled", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const accounts = sqliteTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  })
);

export const authSessions = sqliteTable("auth_sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  })
);

// ── Email blacklist ──────────────────────────────────────────────────

export const bannedEmails = sqliteTable("banned_emails", {
  email: text("email").primaryKey(),
  reason: text("reason"),
  bannedBy: text("banned_by"),
  bannedAt: integer("banned_at", { mode: "timestamp" }),
});

// ── Study app tables ─────────────────────────────────────────────────

/** Cumulative time goal across multiple study sessions (e.g. 300 min total). */
export const studyGoals = sqliteTable("study_goals", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  goalType: text("goal_type").notNull(), // "time"
  targetValue: integer("target_value").notNull(), // total minutes across linked sessions
  documentJson: text("document_json"), // optional: same doc as first session for UI filtering
  status: text("status").notNull().default("active"), // active | completed
  createdAt: integer("created_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const studySessions = sqliteTable("study_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  goalType: text("goal_type").notNull(), // "time" | "chapter"
  targetValue: integer("target_value").notNull(),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp" }),
  totalFocusedMinutes: integer("total_focused_minutes"),
  pagesVisited: integer("pages_visited"),
  visitedPagesList: text("visited_pages_list"), // JSON: number[] of unique page indices visited
  lastPageIndex: integer("last_page_index"),
  sessionState: text("session_state").default("live"), // live | paused — paused sessions are not auto-closed on new POST
  studyGoalId: text("study_goal_id").references(() => studyGoals.id, {
    onDelete: "set null",
  }),
  videosJson: text("videos_json"), // JSON: { title, searchQuery, reason }[]
  documentJson: text("document_json"), // JSON: serialized SelectedDocument for resume
  /** How the session ended: goal_reached | boss_cleared | phrase_fallback | gate_off | offline */
  exitMethod: text("exit_method"),
  createdAt: integer("created_at", { mode: "timestamp" }),
});

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  sourceType: text("source_type").notNull(), // "upload" | "textbook"
  textbookCatalogId: text("textbook_catalog_id"),
  fileUrl: text("file_url"), // Vercel Blob URL for uploaded PDFs
  totalPages: integer("total_pages"),
  fileSizeBytes: integer("file_size_bytes"),                 // size of uploaded blob in bytes
  chapterPageRanges: text("chapter_page_ranges"), // JSON: Record<string, [number, number]> — user-defined TOC
  pageOffset: integer("page_offset"),             // PDF page 1 = textbook page (1 + pageOffset)
  extractedText: text("extracted_text"),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const textbookCatalog = sqliteTable("textbook_catalog", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  edition: text("edition"),
  isbn: text("isbn"),
  sourceType: text("source_type").notNull(), // "oer" | "user_upload"
  sourceUrl: text("source_url"),
  cachedBlobUrl: text("cached_blob_url"),  // globally cached public Blob copy (one per catalog entry)
  chapterPageRanges: text("chapter_page_ranges"), // JSON string
  pageOffset: integer("page_offset").default(0), // book page 1 = PDF page (1 + offset)
  hidden: integer("hidden", { mode: "boolean" }).default(false),
  visibleToUserIds: text("visible_to_user_ids"), // JSON array of user ids who can see when hidden
  createdAt: integer("created_at", { mode: "timestamp" }),
});

export const sessionContent = sqliteTable("session_content", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => studySessions.id, { onDelete: "cascade" }),
  documentId: text("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  chapterOrPageStart: integer("chapter_or_page_start"),
  chapterOrPageEnd: integer("chapter_or_page_end"),
  createdAt: integer("created_at", { mode: "timestamp" }),
});

// ── Page visit tracking ──────────────────────────────────────────────

export const pageVisits = sqliteTable("page_visits", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => studySessions.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number").notNull(),
  enteredAt: integer("entered_at", { mode: "timestamp" }).notNull(),
  leftAt: integer("left_at", { mode: "timestamp" }),
  /**
   * Wall-clock duration on this page (`leftAt − enteredAt`). Includes
   * paused / idle / tab-blurred time, so a single open page that the
   * user walks away from can read 23h+. Used by the existing per-page
   * reading-time bar chart.
   */
  durationSeconds: integer("duration_seconds"),
  /**
   * Subset of `durationSeconds` during which the session timer was
   * actually running (not paused, not in inactivity prompt, not in a
   * Pomodoro break). Powers the developer-mode "Focused studying per
   * page" admin panel. NULL = visit predates per-page focus tracking
   * (the schema column was added later); the panel renders an empty
   * state for those sessions.
   */
  focusedSeconds: integer("focused_seconds"),
});

// ── Bookmarks & Highlights ───────────────────────────────────────────

export const bookmarks = sqliteTable("bookmarks", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sessionId: text("session_id"),
  documentId: text("document_id").notNull(),
  pageNumber: integer("page_number").notNull(),
  type: text("type").notNull(), // "bookmark" | "highlight"
  label: text("label"),
  highlightText: text("highlight_text"),
  color: text("color"), // "yellow" | "green" | "blue" | "pink"
  tag: text("tag"), // "definition" | "key_concept" | "review" | "important" | null
  createdAt: integer("created_at", { mode: "timestamp" }),
});

// ── Messaging ───────────────────────────────────────────────────────

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  fromUserId: text("from_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  toUserId: text("to_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  read: integer("read", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }),
});

// ── Study planner ────────────────────────────────────────────────────

export const studyPlans = sqliteTable("study_plans", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Sun ... 6=Sat
  startTime: text("start_time").notNull(), // "HH:MM"
  endTime: text("end_time").notNull(), // "HH:MM"
  label: text("label"), // e.g. "Biology Ch 5-6"
  textbookCatalogId: text("textbook_catalog_id"),
  createdAt: integer("created_at", { mode: "timestamp" }),
});

// ── Exam countdowns ──────────────────────────────────────────────────

export const examCountdowns = sqliteTable("exam_countdowns", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(), // e.g. "Biology Final"
  examDate: integer("exam_date", { mode: "timestamp" }).notNull(),
  textbookCatalogId: text("textbook_catalog_id"),
  totalPages: integer("total_pages"), // for daily page target calc
  pagesCompleted: integer("pages_completed").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }),
});

// ── AI tables ────────────────────────────────────────────────────────

export const aiNotes = sqliteTable("ai_notes", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => studySessions.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number"),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
});

export const quizzes = sqliteTable("quizzes", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => studySessions.id, { onDelete: "cascade" }),
  questionsJson: text("questions_json").notNull(), // JSON array of { question, options, correctIndex, explanation }
  reviewJson: text("review_json"), // JSON { keyConcepts, thingsToReview, videoSuggestions }
  score: integer("score"),
  totalQuestions: integer("total_questions"),
  createdAt: integer("created_at", { mode: "timestamp" }),
});

// ── App-wide settings (key/value) — e.g. owner AI prompt extras ─────────

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// ── Public shared notes (one per catalog textbook page, shared across users) ──

export const publicNotes = sqliteTable("public_notes", {
  id: text("id").primaryKey(),
  textbookCatalogId: text("textbook_catalog_id").notNull(),
  pageNumber: integer("page_number").notNull(),
  content: text("content").notNull(),
  promptVersion: integer("prompt_version").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

/** Per-upload notes cache — keyed by document + page (mirrors public_notes for catalog). */
export const documentNotes = sqliteTable("document_notes", {
  id: text("id").primaryKey(),
  documentId: text("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number").notNull(),
  content: text("content").notNull(),
  promptVersion: integer("prompt_version").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

/** Reusable quiz question bank for uploaded PDFs — keyed by document + page. */
export const documentQuizQuestions = sqliteTable("document_quiz_questions", {
  id: text("id").primaryKey(),
  documentId: text("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  /** 1-indexed page; 0 = unknown. */
  pageIndex: integer("page_index").notNull().default(0),
  /** { question, options, correctIndex, explanation, pageIndex? } */
  questionJson: text("question_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
});

// ── Global site config (single-row, id always = 1) ──────────────────────────

export const globalConfig = sqliteTable("global_config", {
  id: integer("id").primaryKey(),
  settingsLayoutJson: text("settings_layout_json"), // JSON: SettingsLayoutConfig
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// ── Flashcards (generated from session AI notes) ─────────────────────────────

export const flashcards = sqliteTable("flashcards", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => studySessions.id, { onDelete: "cascade" }),
  /** Upload cache key — cards with the same document_id share SRS across sessions. */
  documentId: text("document_id").references(() => documents.id, {
    onDelete: "cascade",
  }),
  front: text("front").notNull(),    // term or question
  back: text("back").notNull(),      // definition or answer
  pageNumber: integer("page_number"),
  createdAt: integer("created_at", { mode: "timestamp" }),

  // ── SRS scheduling state (FSRS-4.5) ─────────────────────────────────
  // 0 = New (never reviewed), 1 = Learning (sub-day intervals while ramping
  // up), 2 = Review (mature, day+ intervals), 3 = Relearning (was mature,
  // user pressed Again, now back to sub-day intervals until stable again).
  // Default 0 means every existing flashcard row pre-SRS becomes a "new"
  // card on first /review visit — no migration script required.
  srsState: integer("srs_state").notNull().default(0),
  // FSRS internal: days the memory will hold at 90% retrievability.
  // Real number because the algorithm produces non-integer days.
  stability: real("stability").notNull().default(0),
  // FSRS internal card difficulty in [1, 10]. 0 here means "uninitialized"
  // — the scheduler bumps it on first grade.
  difficulty: real("difficulty").notNull().default(0),
  // When this card next becomes due. NULL on truly new cards (never
  // graded). Indexed via a separate index below — this is the hot read
  // path for the `/api/review/queue` endpoint.
  dueAt: integer("due_at", { mode: "timestamp" }),
  lastReviewedAt: integer("last_reviewed_at", { mode: "timestamp" }),
  // Number of times the user pressed Again on this card. Used by FSRS
  // and surfaced in admin/dev panels to find "leech" cards.
  lapses: integer("lapses").notNull().default(0),
  // Total grade events on this card (any rating). `reps = 1` distinguishes
  // "introduced today" from "reviewed today" for the new-card cap.
  reps: integer("reps").notNull().default(0),
  // FSRS internal: which sub-day step the card is currently on while
  // in Learning or Relearning state. Critical for graduation: without
  // this, a card stuck in Learning state never advances to Review
  // because every Good looks like "first step" to the scheduler.
  learningSteps: integer("learning_steps").notNull().default(0),
});

// ── Velocity reaction-speed minigame ─────────────────────────────────────

export const velocityGames = sqliteTable("velocity_games", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => studySessions.id, { onDelete: "cascade" }),
  questionsJson: text("questions_json").notNull(), // JSON: VelocityQuestion[]
  resultsJson: text("results_json"), // JSON: VelocityResults (per-question attempts, accuracy, reaction stats)
  reviewJson: text("review_json"), // JSON: { growthAreas: string[], videoSuggestions: {title,searchQuery,reason}[] }
  accuracy: integer("accuracy"), // 0-100
  avgReactionMs: integer("avg_reaction_ms"),
  createdAt: integer("created_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

/**
 * Reusable question bank for the Velocity minigame.
 *
 * Every AI-generated question is persisted here so that subsequent games for the
 * same document + page set can pull from the existing pool instead of paying
 * for fresh generation every time. Keyed by `sourceKey` (stable identifier for
 * the reading material — "textbook:<catalogId>" for shared textbooks, or
 * "doc:<documentId>" for uploaded PDFs) and `pageIndex` (the 1-indexed page
 * number the question was sourced from). Questions from textbooks are
 * automatically shared across all users reading that same textbook.
 */
export const velocityQuestionBank = sqliteTable("velocity_question_bank", {
  id: text("id").primaryKey(),
  /** "textbook:<id>" for shared textbooks, "doc:<id>" for user uploads. */
  sourceKey: text("source_key").notNull(),
  /** 1-indexed page this question's concept was sourced from (0 = unknown). */
  pageIndex: integer("page_index").notNull().default(0),
  /** Short concept label (copied from the question for indexing/UI). */
  topic: text("topic"),
  /** "mc" | "sa" — stored redundantly so we can filter without JSON parsing. */
  type: text("type").notNull(),
  /** Full VelocityQuestion serialised as JSON. */
  questionJson: text("question_json").notNull(),
  /** User who triggered the generation run that produced this question. */
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }),
  /**
   * Number of times users have hit "Report" on this question. Reads from
   * the bank filter out any row with reportCount above
   * `BAD_QUESTION_REPORT_THRESHOLD` so a single bad question can't keep
   * showing up to every future user. Admins can inspect the questionJson
   * to decide whether to keep, fix, or hard-delete the row.
   */
  reportCount: integer("report_count").notNull().default(0),
  /** Free-form reason from the most recent reporter (truncated to 500 chars). */
  lastReportReason: text("last_report_reason"),
  /** When the question was first reported. Null = never reported. */
  firstReportedAt: integer("first_reported_at", { mode: "timestamp" }),
});

/**
 * Per-call AI usage log. One row every time we call OpenAI on a user's
 * behalf — lets admins see a full history of which routes a user spent
 * tokens on, when, and how much each call cost. The running `aiTokensUsed`
 * counter on `users` is the sum of `totalTokens` across all rows here for
 * that user (we keep the counter denormalised for fast reads).
 */
export const aiUsageLogs = sqliteTable("ai_usage_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** e.g. "/api/ai/notes", "/api/ai/velocity", "/api/admin/owner-ai/chat" */
  route: text("route").notNull(),
  /** OpenAI model id used for the call. */
  model: text("model"),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  /** Full prompt sent to the model (admin audit; NULL on legacy rows). */
  inputText: text("input_text"),
  /** Full model response text or JSON (admin audit; NULL on legacy rows). */
  outputText: text("output_text"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ── Client debug errors (posted from browser; admin reads) ───────────────

export const clientErrorLogs = sqliteTable("client_error_logs", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  /** `user` = browser/user errors; `dev` = owner feature-debug entries */
  kind: text("kind").notNull().default("user"),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  email: text("email"),
  message: text("message").notNull(),
  stack: text("stack"),
  url: text("url"),
  userAgent: text("user_agent"),
  extra: text("extra"), // JSON string
});
