import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

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
  themeId: text("theme_id"), // custom theme color set id
  image: text("image"),
  emailVerified: integer("email_verified", { mode: "timestamp" }),
  mutedUntil: integer("muted_until", { mode: "timestamp" }),
  isAdmin: integer("is_admin", { mode: "boolean" }).default(false),
  blocked: integer("blocked", { mode: "boolean" }).default(false),
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
  videosJson: text("videos_json"), // JSON: { title, searchQuery, reason }[]
  documentJson: text("document_json"), // JSON: serialized SelectedDocument for resume
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
  durationSeconds: integer("duration_seconds"),
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
  front: text("front").notNull(),    // term or question
  back: text("back").notNull(),      // definition or answer
  pageNumber: integer("page_number"),
  createdAt: integer("created_at", { mode: "timestamp" }),
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
