/**
 * Spaced-repetition review page.
 *
 * Fullscreen, distraction-free review across every textbook the user
 * has flashcards in. Pulls due cards from `/api/review/queue` and
 * grades them through `/api/review/grade`. See
 * `components/review/ReviewSession.tsx` for the lifecycle and
 * keyboard shortcut details.
 *
 * Auth: this is gated through `getAppUser()` inside each API route,
 * so the page itself is rendered for everyone — unauthenticated
 * users will see a network error from the queue fetch and bounce
 * back to dashboard via the "Exit" link. We deliberately don't
 * server-side-redirect here; the auth UX (sign-in modal vs full
 * page) lives in `lib/auth.ts` and is consistent app-wide.
 */
import { ReviewSession } from "@/components/review/ReviewSession";

export const dynamic = "force-dynamic";

export default function ReviewPage() {
  return <ReviewSession />;
}
