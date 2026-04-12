/**
 * LLMs often emit LaTeX (e.g. \\( 1 \\text{ in} = 2.54 \\text{ cm} \\)) but the UI
 * only does simple markdown→HTML. Strip common LaTeX so notes read as plain text.
 */
export function stripLatexForAiNotes(text: string): string {
  let s = text;
  s = s.replace(/\\text\{([^}]*)\}/g, "$1");
  s = s.replace(/\\mathrm\{([^}]*)\}/g, "$1");
  s = s.replace(/\\\(/g, "");
  s = s.replace(/\\\)/g, "");
  s = s.replace(/\\\[/g, "");
  s = s.replace(/\\\]/g, "");
  s = s.replace(/\$\$/g, "");
  s = s.replace(/\\,/g, " ");
  s = s.replace(/\\quad/g, " ");
  s = s.replace(/\\cdot/g, "·");
  s = s.replace(/\\times/g, "×");
  s = s.replace(/\\approx/g, "≈");
  s = s.replace(/\\leq/g, "≤");
  s = s.replace(/\\geq/g, "≥");
  s = s.replace(/\\neq/g, "≠");
  s = s.replace(/  +/g, " ");
  return s.trim();
}

/** Bold bullets + newlines → HTML for AI note cards. */
export function aiNoteContentToHtml(content: string): string {
  return stripLatexForAiNotes(content)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n- /g, "<br/>• ")
    .replace(/\n/g, "<br/>");
}
