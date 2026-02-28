import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";

export interface User {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StudySession {
  id: string;
  userId: string;
  goalType: string;
  targetValue: number;
  startedAt: string;
  endedAt: string | null;
  totalFocusedMinutes: number | null;
  lastPageIndex: number | null;
  createdAt: string | null;
}

export interface DocRecord {
  id: string;
  userId: string;
  title: string | null;
  sourceType: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TextbookEntry {
  id: string;
  title: string;
  edition: string | null;
  isbn: string | null;
  sourceType: string;
  sourceUrl: string | null;
  chapterPageRanges: string | null;
  createdAt: string | null;
}

export interface AiNote {
  id: string;
  sessionId: string;
  pageNumber: number | null;
  content: string;
  createdAt: string | null;
}

export interface Quiz {
  id: string;
  sessionId: string;
  questionsJson: string;
  reviewJson: string | null;
  score: number | null;
  totalQuestions: number | null;
  createdAt: string | null;
}

interface StoreData {
  users: User[];
  studySessions: StudySession[];
  documents: DocRecord[];
  textbookCatalog: TextbookEntry[];
  aiNotes: AiNote[];
  quizzes: Quiz[];
}

const MAX_USERS = 25;
const STORE_PATH = path.join(process.cwd(), "data", "store.json");

function empty(): StoreData {
  return {
    users: [],
    studySessions: [],
    documents: [],
    textbookCatalog: [],
    aiNotes: [],
    quizzes: [],
  };
}

function read(): StoreData {
  try {
    if (!existsSync(STORE_PATH)) return empty();
    return JSON.parse(readFileSync(STORE_PATH, "utf-8"));
  } catch {
    return empty();
  }
}

function write(data: StoreData) {
  const dir = path.dirname(STORE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

export const store = {
  // ── Users ──────────────────────────────────────────────────────────
  getUser(email: string): User | undefined {
    return read().users.find((u) => u.email === email);
  },
  getUserById(id: string): User | undefined {
    return read().users.find((u) => u.id === id);
  },
  createUser(user: User): User {
    const data = read();
    if (data.users.length >= MAX_USERS) {
      throw new Error("Maximum number of users (25) reached");
    }
    data.users.push(user);
    write(data);
    return user;
  },

  // ── Study sessions ────────────────────────────────────────────────
  getSessionsByUser(userId: string): StudySession[] {
    return read().studySessions.filter((s) => s.userId === userId);
  },
  getSession(id: string, userId: string): StudySession | undefined {
    return read().studySessions.find(
      (s) => s.id === id && s.userId === userId
    );
  },
  createSession(session: StudySession): StudySession {
    const data = read();
    data.studySessions.push(session);
    write(data);
    return session;
  },
  updateSession(id: string, updates: Partial<StudySession>) {
    const data = read();
    const idx = data.studySessions.findIndex((s) => s.id === id);
    if (idx !== -1) {
      data.studySessions[idx] = { ...data.studySessions[idx], ...updates };
      write(data);
    }
  },

  // ── Documents ─────────────────────────────────────────────────────
  getDocument(id: string, userId: string): DocRecord | undefined {
    return read().documents.find(
      (d) => d.id === id && d.userId === userId
    );
  },
  createDocument(doc: DocRecord) {
    const data = read();
    data.documents.push(doc);
    write(data);
  },

  // ── Textbook catalog ──────────────────────────────────────────────
  getTextbooks(): TextbookEntry[] {
    return read().textbookCatalog;
  },
  upsertTextbook(entry: TextbookEntry) {
    const data = read();
    const idx = data.textbookCatalog.findIndex((t) => t.id === entry.id);
    if (idx !== -1) {
      data.textbookCatalog[idx] = entry;
    } else {
      data.textbookCatalog.push(entry);
    }
    write(data);
  },
  updateTextbook(id: string, updates: Partial<TextbookEntry>) {
    const data = read();
    const idx = data.textbookCatalog.findIndex((t) => t.id === id);
    if (idx !== -1) {
      data.textbookCatalog[idx] = { ...data.textbookCatalog[idx], ...updates };
      write(data);
    }
  },

  // ── AI Notes ──────────────────────────────────────────────────────
  getNotesBySession(sessionId: string): AiNote[] {
    return read().aiNotes.filter((n) => n.sessionId === sessionId);
  },
  createNote(note: AiNote) {
    const data = read();
    data.aiNotes.push(note);
    write(data);
  },

  // ── Quizzes ───────────────────────────────────────────────────────
  getQuizBySession(sessionId: string): Quiz | undefined {
    return read().quizzes.find((q) => q.sessionId === sessionId);
  },
  createQuiz(quiz: Quiz) {
    const data = read();
    data.quizzes.push(quiz);
    write(data);
  },
};
