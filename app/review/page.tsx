/**
 * Spaced-repetition review page.
 *
 * Two-screen flow:
 *
 *   1. **Home screen** (`<ReviewHome>`) — picks the deck / mode / age /
 *      limit. Default is "what's due now" so the very first session
 *      after creating cards still works without futzing with filters.
 *   2. **Session** (`<ReviewSession>`) — the fullscreen review with the
 *      home screen's selections passed through as a config object.
 *
 * The mode toggle lives in client state (no router push) so the
 * browser back button drops the user from the session back to the
 * home screen with their selections intact, rather than escaping the
 * /review page entirely. "Exit" from the session also returns to
 * home so the user can quickly tweak filters and try again.
 *
 * Auth: gated inside each `/api/review/*` route via `getAppUser()`.
 * The page itself renders for everyone; unauthenticated users see a
 * network error from the decks fetch and bounce back to dashboard
 * via the "← Dashboard" link.
 */
"use client";

import { useState } from "react";
import { ReviewHome, type ReviewConfig } from "@/components/review/ReviewHome";
import { ReviewSession } from "@/components/review/ReviewSession";

export default function ReviewPage() {
  const [config, setConfig] = useState<ReviewConfig | null>(null);

  if (config) {
    return (
      <ReviewSession
        config={config}
        onExit={() => setConfig(null)}
      />
    );
  }

  return <ReviewHome onStart={setConfig} />;
}
