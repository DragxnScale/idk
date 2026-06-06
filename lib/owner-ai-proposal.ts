import { OWNER_AI_SETTING_KEYS } from "@/lib/owner-ai-settings-shared";

/** Extract a balanced `{…}` object starting at `start` (handles strings/escapes). */
function extractBalancedJsonObject(text: string, start: number): string | null {
  if (text[start] !== "{") return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function normalizePatchKey(key: string): string {
  if (
    (Object.values(OWNER_AI_SETTING_KEYS) as string[]).includes(key)
  ) {
    return key;
  }
  if (key in OWNER_AI_SETTING_KEYS) {
    return OWNER_AI_SETTING_KEYS[key as keyof typeof OWNER_AI_SETTING_KEYS];
  }
  return key;
}

function parseProposalObject(parsed: {
  type?: string;
  patches?: Record<string, unknown>;
  summary?: string;
}): { patches: Record<string, string>; summary: string } | null {
  if (parsed.type !== "owner_ai_proposal" || !parsed.patches) return null;

  const patches: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.patches)) {
    if (typeof v !== "string") continue;
    const dbKey = normalizePatchKey(k);
    if (!(Object.values(OWNER_AI_SETTING_KEYS) as string[]).includes(dbKey)) continue;
    patches[dbKey] = v;
  }

  if (Object.keys(patches).length === 0) return null;

  return {
    patches,
    summary:
      typeof parsed.summary === "string"
        ? parsed.summary
        : "Proposed settings update",
  };
}

function tryParseProposalJson(jsonStr: string): {
  patches: Record<string, string>;
  summary: string;
} | null {
  try {
    const parsed = JSON.parse(jsonStr) as {
      type?: string;
      patches?: Record<string, unknown>;
      summary?: string;
    };
    return parseProposalObject(parsed);
  } catch {
    return null;
  }
}

function collectProposalCandidates(content: string): string[] {
  const candidates: string[] = [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(content)) !== null) {
    if (m[1]?.trim()) candidates.push(m[1].trim());
  }
  candidates.push(content);
  return candidates;
}

/** Parse proposal JSON from owner copilot assistant message (client + server safe). */
export function parseOwnerAiProposal(content: string): {
  patches: Record<string, string>;
  summary: string;
} | null {
  for (const candidate of collectProposalCandidates(content)) {
    const marker = '"owner_ai_proposal"';
    let searchFrom = 0;
    while (searchFrom < candidate.length) {
      const markerIdx = candidate.indexOf(marker, searchFrom);
      if (markerIdx === -1) break;
      searchFrom = markerIdx + marker.length;

      let braceIdx = candidate.lastIndexOf("{", markerIdx);
      while (braceIdx !== -1) {
        const jsonStr = extractBalancedJsonObject(candidate, braceIdx);
        if (jsonStr) {
          const proposal = tryParseProposalJson(jsonStr);
          if (proposal) return proposal;
        }
        braceIdx = candidate.lastIndexOf("{", braceIdx - 1);
      }
    }
  }
  return null;
}

/** Remove machine-parseable proposal JSON from assistant text for chat display. */
export function stripOwnerAiProposalFromDisplay(content: string): string {
  const marker = '"owner_ai_proposal"';
  let result = content;
  let markerIdx = result.indexOf(marker);
  while (markerIdx !== -1) {
    let braceIdx = result.lastIndexOf("{", markerIdx);
    let removed = false;
    while (braceIdx !== -1) {
      const jsonStr = extractBalancedJsonObject(result, braceIdx);
      if (jsonStr) {
        try {
          const parsed = JSON.parse(jsonStr) as { type?: string };
          if (parsed.type === "owner_ai_proposal") {
            result = (result.slice(0, braceIdx) + result.slice(braceIdx + jsonStr.length)).trim();
            removed = true;
            break;
          }
        } catch {
          // try earlier brace
        }
      }
      braceIdx = result.lastIndexOf("{", braceIdx - 1);
    }
    if (!removed) break;
    markerIdx = result.indexOf(marker);
  }

  // Strip empty fenced code blocks left behind
  return result.replace(/```(?:json)?\s*```/g, "").trim();
}

export function contentMentionsOwnerAiProposal(content: string): boolean {
  return content.includes("owner_ai_proposal");
}
