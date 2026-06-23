/**
 * HMAC-signed tokens for Boss Beacons exit gate (stateless, serverless-safe).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not configured");
  return s;
}

function b64urlEncode(data: string): string {
  return Buffer.from(data, "utf8").toString("base64url");
}

function b64urlDecode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function signPayload(payload: Record<string, unknown>): string {
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyToken<T extends Record<string, unknown>>(
  token: string,
  expectedKind: string
): T | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  try {
    const a = Buffer.from(sig, "base64url");
    const b = Buffer.from(expected, "base64url");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(b64urlDecode(body)) as T & {
      kind?: string;
      exp?: number;
      sessionId?: string;
    };
    if (payload.kind !== expectedKind) return null;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    return payload as T;
  } catch {
    return null;
  }
}

export interface BossTokenPayload extends Record<string, unknown> {
  kind: "exit_boss";
  sessionId: string;
  bankRowId: string;
  correctIndex: number;
  explanation?: string | null;
  exp: number;
}

export function signBossToken(opts: {
  sessionId: string;
  bankRowId: string;
  correctIndex: number;
  explanation?: string;
}): string {
  return signPayload({
    kind: "exit_boss",
    sessionId: opts.sessionId,
    bankRowId: opts.bankRowId,
    correctIndex: opts.correctIndex,
    explanation: opts.explanation ?? null,
    exp: Date.now() + TOKEN_TTL_MS,
  });
}

export function verifyBossToken(
  token: string,
  sessionId: string
): BossTokenPayload | null {
  const p = verifyToken<BossTokenPayload>(token, "exit_boss");
  if (!p || p.sessionId !== sessionId) return null;
  if (
    typeof p.correctIndex !== "number" ||
    p.correctIndex < 0 ||
    p.correctIndex > 3
  ) {
    return null;
  }
  return {
    ...p,
    explanation: p.explanation ?? undefined,
  };
}

export interface PhraseTokenPayload extends Record<string, unknown> {
  kind: "exit_phrase";
  sessionId: string;
  phrase: string;
  exp: number;
}

const PHRASE_WORDS = [
  "purple", "beacon", "focus", "orbit", "crystal", "ember", "signal",
  "anchor", "summit", "drift", "pulse", "shadow", "spark", "violet",
  "cobalt", "frost", "ember", "quartz", "nova", "prism",
];

/** Randomize per-letter case so autofill can't match a predictable pattern. */
function randomizeLetterCase(word: string): string {
  return word
    .split("")
    .map((ch) => {
      if (!/[a-z]/i.test(ch)) return ch;
      return Math.random() < 0.5 ? ch.toUpperCase() : ch.toLowerCase();
    })
    .join("");
}

export function generateExitPhrase(): string {
  const w1 = PHRASE_WORDS[Math.floor(Math.random() * PHRASE_WORDS.length)];
  let w2 = PHRASE_WORDS[Math.floor(Math.random() * PHRASE_WORDS.length)];
  while (w2 === w1) {
    w2 = PHRASE_WORDS[Math.floor(Math.random() * PHRASE_WORDS.length)];
  }
  const num = Math.floor(Math.random() * 90) + 10;
  return `${randomizeLetterCase(w1)}-${randomizeLetterCase(w2)}-${num}`;
}

export function signPhraseToken(opts: {
  sessionId: string;
  phrase: string;
}): string {
  return signPayload({
    kind: "exit_phrase",
    sessionId: opts.sessionId,
    phrase: opts.phrase,
    exp: Date.now() + TOKEN_TTL_MS,
  });
}

export function verifyPhraseToken(
  token: string,
  sessionId: string,
  typedPhrase: string
): boolean {
  const p = verifyToken<PhraseTokenPayload>(token, "exit_phrase");
  if (!p || p.sessionId !== sessionId) return false;
  const expected = p.phrase.trim();
  const actual = typedPhrase.trim();
  if (!expected || !actual) return false;
  if (expected.length !== actual.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(actual, "utf8")
    );
  } catch {
    return false;
  }
}
