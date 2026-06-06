/** Parse proposal JSON from owner copilot assistant message (client + server safe). */
export function parseOwnerAiProposal(content: string): {
  patches: Record<string, string>;
  summary: string;
} | null {
  const jsonMatch = content.match(
    /\{[\s\S]*?"type"\s*:\s*"owner_ai_proposal"[\s\S]*?\}/
  );
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      type?: string;
      patches?: Record<string, unknown>;
      summary?: string;
    };
    if (parsed.type !== "owner_ai_proposal" || !parsed.patches) return null;
    const patches: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.patches)) {
      if (typeof v === "string") patches[k] = v;
    }
    if (Object.keys(patches).length === 0) return null;
    return {
      patches,
      summary: typeof parsed.summary === "string" ? parsed.summary : "Proposed settings update",
    };
  } catch {
    return null;
  }
}
