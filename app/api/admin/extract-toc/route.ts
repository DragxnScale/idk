import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { extractText, getDocumentProxy } from "unpdf";
import { requireAdmin } from "@/lib/admin";
import { getAppUser } from "@/lib/app-user";
import {
  openai,
  MODEL,
  isAiConfigured,
  wrapUntrusted,
  UNTRUSTED_INPUT_GUARD,
} from "@/lib/ai";
import { appendOwnerStyleToSystem, getAiOwnerStyleExtra } from "@/lib/app-settings";
import { assertAiBudget, recordAiUsage } from "@/lib/ai-usage";
import { fetchPdf } from "@/lib/storage-backend";

/**
 * Admin TOC extractor: reads the freshly-uploaded PDF, scans the first
 * ~30 pages of front matter for the table of contents, and asks the
 * model to return a structured chapter list + page offset so the admin
 * UI can pre-populate its visual TOC editor.
 *
 * Front matter only — the TOC is always near the beginning, and parsing
 * a full 1000-page textbook server-side would blow past the model's
 * context window (and waste budget). 30 pages is generous enough to
 * cover every textbook layout we've seen in practice: half-title,
 * title, copyright, dedication, foreword, preface, and the contents
 * block all comfortably fit.
 */
export const maxDuration = 60;
export const runtime = "nodejs";

/** Max number of front-matter pages we extract + send to the model. */
const TOC_SCAN_PAGE_LIMIT = 30;

/**
 * Hard cap on the size of the extracted text we feed the model. A
 * pathological PDF with very dense text on every front-matter page
 * could otherwise blow past the context window. 60K chars ≈ 15K
 * tokens, which is well below the model's window while still
 * comfortably fitting any realistic TOC.
 */
const TOC_TEXT_CHAR_LIMIT = 60_000;

/** Flat schema — OpenAI structured outputs reject `oneOf`/discriminated unions. */
const tocSchema = z.object({
  /**
   * PDF page where book page 1 lives, minus one. So if "Chapter 1" /
   * book page 1 is on PDF page 22, offset = 21. 0 when the model
   * can't determine it (the existing TOC editor uses 0 as "no
   * offset", which matches our default).
   */
  pageOffset: z.number().int().min(0),
  chapters: z.array(
    z.object({
      /** "1", "Chapter 1", "Chapter 1: Here and Now" — whatever the book uses. */
      label: z.string().min(1).max(80),
      /** Book page number (NOT PDF page) where this chapter starts. */
      startBookPage: z.number().int().min(1),
      /** Book page number where this chapter ends. */
      endBookPage: z.number().int().min(1),
    })
  ),
  /** True when the model found a real TOC. False = the doc has no chapters. */
  foundToc: z.boolean(),
  /** "ok" on success, or a short human-readable explanation when foundToc=false. */
  reason: z.string().max(400),
});

const SYSTEM_PROMPT = `You are reading the FRONT MATTER of a PDF (the first ${TOC_SCAN_PAGE_LIMIT} pages). The extracted text is broken into "[Page N]" blocks where N is the 1-indexed PDF page that block was extracted from.

Your job is to find the table of contents and return a structured chapter list.

═══════════════════════════════════════════════════════════════════
RULES
═══════════════════════════════════════════════════════════════════
1. Find the page or pages that contain the table of contents (usually titled "Contents", "Table of Contents", or similar — but the marker may be absent and you'll just see a list of chapter titles followed by page numbers).
2. Identify every NUMBERED chapter the book lists. Use the book's own scheme — "Chapter 1", "1.", "Part I Chapter 1", a bare "1", whatever appears in the TOC. Skip non-chapter front matter (Preface, Foreword, Acknowledgements, About the Author) and back matter (Index, Glossary, Bibliography, Appendix A) unless they're explicitly numbered chapters.
3. For each chapter, return the BOOK page where it starts (i.e. the page number printed inside the book itself — what the TOC lists). NOT the PDF page. Example: if "Chapter 3 ............ 47" appears in the TOC, startBookPage = 47.
4. End page of each chapter = (next chapter's start − 1) in book pages. For the LAST chapter, set end = (start + 25) as a rough estimate — the admin can correct it.
5. Compute pageOffset = (PDF page where book page 1 first appears) − 1. To find this, scan the [Page N] markers for the first page whose body looks like the start of Chapter 1, or for the page that explicitly shows the printed page number "1". If the front matter is unpaginated (no roman numerals visible) and the first numbered page is "1", that PDF page's N minus 1 is the offset. Return 0 when you genuinely cannot determine it.
6. Use the EXACT label the book uses, kept short (under 80 characters). If the TOC just shows "1", "2", "3", return "1", "2", "3" — do NOT decorate them with "Chapter". If the TOC says "Chapter 1: Here and Now", return that full label.
7. If the document doesn't appear to have numbered chapters at all — a single research paper, an article, a one-chapter PDF — set foundToc=false with a one-sentence reason like "Document is a research paper without numbered chapters" and return chapters=[], pageOffset=0.
8. Do NOT invent chapters. If the TOC is partly unreadable, return only the chapters you can extract and explain the gap in reason (e.g. "Chapters 5–7 unreadable in extracted text").
9. Order chapters in ascending order by startBookPage. Do NOT return duplicates.

If everything went fine, set foundToc=true and reason="ok".`;

/**
 * Read every byte of a ReadableStream into a single Buffer. Pulled
 * inline rather than imported so the route stays self-contained.
 */
async function readStreamToBuffer(stream: ReadableStream): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Pull text from the FIRST N pages of a PDF. Returns a single string
 * with `[Page N]` markers between blocks, matching the convention used
 * by the rest of the AI routes (see `parseReadingPages` in the velocity
 * route). We iterate page-by-page rather than calling unpdf's bulk
 * `extractText` so a 1000-page textbook only does the work for its
 * first 30 pages, not all 1000.
 */
async function extractFrontMatterText(
  pdfBytes: Uint8Array,
  maxPages: number
): Promise<{ text: string; pagesRead: number; totalPages: number }> {
  const pdf = await getDocumentProxy(pdfBytes);
  const totalPages = pdf.numPages;
  const pageLimit = Math.min(maxPages, totalPages);

  // `extractText` with mergePages:false is the simplest path — it
  // already returns per-page strings — but it always processes every
  // page in the document. For a 1000-page textbook the front-matter
  // path would do 30 pages of useful work plus 970 pages of waste.
  // Doing it manually keeps the route fast and predictable.
  const blocks: string[] = [];
  for (let i = 1; i <= pageLimit; i++) {
    try {
      const page = await pdf.getPage(i);
      const content = (await page.getTextContent()) as { items: Array<{ str?: string }> };
      const pageText = content.items
        .map((item) => (item && typeof item.str === "string" ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      blocks.push(`[Page ${i}]\n${pageText}`);
    } catch {
      // Skip pages that fail to parse — usually image-only scans with
      // no extractable text. We still emit the marker so the model
      // doesn't think the document ended early.
      blocks.push(`[Page ${i}]\n(text extraction failed)`);
    }
  }
  return { text: blocks.join("\n\n"), pagesRead: pageLimit, totalPages };
}

/**
 * Sanity-check the model's chapter list: drop entries that fail any
 * of the contract rules, then sort + dedupe by label. Never fabricate
 * fixes — if a chapter looks wrong we just drop it (the admin can add
 * it manually).
 */
function sanitiseChapters(
  raw: { label: string; startBookPage: number; endBookPage: number }[]
): { label: string; startBookPage: number; endBookPage: number }[] {
  const seenLabels = new Set<string>();
  const cleaned: { label: string; startBookPage: number; endBookPage: number }[] = [];
  for (const ch of raw) {
    const label = (ch.label ?? "").trim().slice(0, 80);
    if (!label) continue;
    if (seenLabels.has(label.toLowerCase())) continue;
    if (
      !Number.isFinite(ch.startBookPage) ||
      !Number.isFinite(ch.endBookPage) ||
      ch.startBookPage < 1 ||
      ch.endBookPage < ch.startBookPage
    ) {
      continue;
    }
    seenLabels.add(label.toLowerCase());
    cleaned.push({
      label,
      startBookPage: Math.floor(ch.startBookPage),
      endBookPage: Math.floor(ch.endBookPage),
    });
  }
  cleaned.sort((a, b) => a.startBookPage - b.startBookPage);

  // Reject chapters whose start is not strictly increasing relative to
  // the previous entry — keeps the editor's chapter list monotonic.
  const out: typeof cleaned = [];
  for (const ch of cleaned) {
    const prev = out[out.length - 1];
    if (prev && ch.startBookPage < prev.startBookPage) continue;
    out.push(ch);
  }
  return out;
}

/**
 * Build the `Record<label, [start, end]>` shape the existing
 * `TocEditor.applyJson` already consumes. Values are **PDF pages**
 * (i.e. book page + offset), matching the JSON-paste convention used
 * throughout the rest of the admin UI: see `tocRowsToRanges` in
 * `app/admin/page.tsx` which adds the offset on write, and
 * `rangesToTocRows` which subtracts it on read. Returning PDF pages
 * here lets the client call `rangesToTocRows(ranges, offset)` directly
 * — exactly the integration the upload tab needs — without the client
 * having to reshape the response.
 */
function chaptersToRanges(
  chapters: { label: string; startBookPage: number; endBookPage: number }[],
  pageOffset: number
): Record<string, [number, number]> {
  const ranges: Record<string, [number, number]> = {};
  for (const ch of chapters) {
    ranges[ch.label] = [
      ch.startBookPage + pageOffset,
      ch.endBookPage + pageOffset,
    ];
  }
  return ranges;
}

export async function POST(request: Request) {
  // Admin gate matches every other /api/admin/* route — `requireAdmin`
  // checks the real (non-impersonated) session, and `getAppUser` is
  // used purely to recover the user id we charge AI usage to.
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI not configured. Set OPENAI_API_KEY in your environment." },
      { status: 503 }
    );
  }

  const overBudget = await assertAiBudget(user.id);
  if (overBudget) return overBudget;

  const body = (await request.json().catch(() => ({}))) as { pdfUrl?: string };
  const pdfUrl = body.pdfUrl?.trim();
  if (!pdfUrl) {
    return NextResponse.json(
      { error: "pdfUrl is required" },
      { status: 400 }
    );
  }

  // ── Fetch the PDF bytes from whichever backend hosts it ────────────
  let pdfBytes: Uint8Array;
  try {
    const fetched = await fetchPdf(pdfUrl, null);
    if (fetched.status < 200 || fetched.status >= 300 || !fetched.body) {
      return NextResponse.json(
        { error: `Failed to fetch PDF from storage (HTTP ${fetched.status})` },
        { status: 502 }
      );
    }
    const buf = await readStreamToBuffer(fetched.body);
    pdfBytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch PDF: ${detail}` },
      { status: 502 }
    );
  }

  // ── Extract text from the first N pages ────────────────────────────
  let pageText: string;
  let pagesRead = 0;
  try {
    const extracted = await extractFrontMatterText(pdfBytes, TOC_SCAN_PAGE_LIMIT);
    pageText = extracted.text;
    pagesRead = extracted.pagesRead;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to extract text from PDF: ${detail}` },
      { status: 422 }
    );
  }

  if (!pageText.trim()) {
    return NextResponse.json(
      {
        error:
          "No extractable text in the first pages of this PDF (it may be a scanned/image-only document).",
      },
      { status: 422 }
    );
  }

  // ── Call the model ─────────────────────────────────────────────────
  const ownerExtra = await getAiOwnerStyleExtra();
  let parsed: z.infer<typeof tocSchema>;
  try {
    const { object, usage } = await generateObject({
      model: openai(MODEL),
      schema: tocSchema,
      system: appendOwnerStyleToSystem(SYSTEM_PROMPT, ownerExtra) + UNTRUSTED_INPUT_GUARD,
      prompt: `Extract the table of contents from the front matter below. There are ${pagesRead} pages of extracted text (PDF pages 1–${pagesRead}), demarcated by "[Page N]" markers.

${wrapUntrusted("pdf front matter", pageText.slice(0, TOC_TEXT_CHAR_LIMIT))}`,
    });
    await recordAiUsage(user.id, "/api/admin/extract-toc", usage);
    parsed = object;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `AI extraction failed: ${detail}` },
      { status: 500 }
    );
  }

  // ── Verifier-style sanity check ────────────────────────────────────
  // Drop chapters that fail the contract (start >= end, non-numeric,
  // duplicate label, non-monotonic order). We never fabricate fixes —
  // the admin will see whatever the model produced and can correct it.
  const cleanedChapters = sanitiseChapters(parsed.chapters ?? []);
  const pageOffset = Number.isFinite(parsed.pageOffset)
    ? Math.max(0, Math.floor(parsed.pageOffset))
    : 0;
  const ranges = chaptersToRanges(cleanedChapters, pageOffset);

  // If the model returned `foundToc: true` but the sanity check
  // emptied the list, downgrade to foundToc:false so the client shows
  // the "AI couldn't find a TOC" copy instead of an empty success.
  const finalFoundToc = parsed.foundToc && cleanedChapters.length > 0;
  const finalReason = finalFoundToc
    ? parsed.reason || "ok"
    : parsed.foundToc && cleanedChapters.length === 0
      ? "Model returned chapters but none passed sanity checks."
      : parsed.reason || "No table of contents found.";

  return NextResponse.json({
    pageOffset,
    ranges,
    foundToc: finalFoundToc,
    reason: finalReason,
  });
}
