/**
 * Groups `ai_usage_logs.route` values into admin-facing feature sections.
 */

export interface AiUsageSectionDef {
  id: string;
  label: string;
  routes: readonly string[];
}

export const AI_USAGE_SECTIONS: readonly AiUsageSectionDef[] = [
  { id: "notes", label: "Notes", routes: ["/api/ai/notes"] },
  {
    id: "quiz",
    label: "Quiz",
    routes: ["/api/ai/quiz", "/api/ai/quiz/factcheck", "/api/ai/quiz/review"],
  },
  { id: "flashcards", label: "Flashcards", routes: ["/api/ai/flashcards"] },
  { id: "videos", label: "Videos", routes: ["/api/ai/videos"] },
  {
    id: "velocity",
    label: "Velocity",
    routes: [
      "/api/ai/velocity",
      "/api/ai/velocity/factcheck",
      "/api/ai/velocity/grade",
      "/api/ai/velocity/grade/selfcheck",
      "/api/ai/velocity/complete",
    ],
  },
  {
    id: "admin",
    label: "Admin / other",
    routes: ["/api/admin/extract-toc", "/api/admin/owner-ai/chat"],
  },
] as const;

const ROUTE_TO_SECTION = new Map<string, string>();
for (const section of AI_USAGE_SECTIONS) {
  for (const route of section.routes) {
    ROUTE_TO_SECTION.set(route, section.id);
  }
}

const SUB_ROUTE_LABELS: Record<string, string> = {
  "/api/ai/notes": "Generation",
  "/api/ai/quiz": "Generation",
  "/api/ai/quiz/factcheck": "Fact-check",
  "/api/ai/quiz/review": "Review",
  "/api/ai/flashcards": "Generation",
  "/api/ai/videos": "Suggestions",
  "/api/ai/velocity": "Generation",
  "/api/ai/velocity/factcheck": "Fact-check",
  "/api/ai/velocity/grade": "Grading",
  "/api/ai/velocity/grade/selfcheck": "Self-check",
  "/api/ai/velocity/complete": "Post-game review",
  "/api/admin/extract-toc": "TOC extract",
  "/api/admin/owner-ai/chat": "Owner chat",
};

export function sectionForRoute(route: string): string {
  return ROUTE_TO_SECTION.get(route) ?? "admin";
}

export function sectionLabelForId(sectionId: string): string {
  return AI_USAGE_SECTIONS.find((s) => s.id === sectionId)?.label ?? "Admin / other";
}

export function subRouteLabel(route: string): string {
  return SUB_ROUTE_LABELS[route] ?? route.replace(/^\/api\/(ai|admin)\//, "");
}

export function routesForSection(sectionId: string): string[] {
  const section = AI_USAGE_SECTIONS.find((s) => s.id === sectionId);
  if (section) return [...section.routes];
  return [];
}
