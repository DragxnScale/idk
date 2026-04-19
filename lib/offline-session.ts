/**
 * Offline session queue — stores sessions locally when the device is offline
 * and syncs them to the server when connectivity returns.
 *
 * All data lives in localStorage under QUEUE_KEY.
 */

const QUEUE_KEY = "bowlbeacon-offline-sessions";

export interface OfflineSession {
  /** Temporary client-side ID (starts with "offline-") */
  tempId: string;
  goalType: string;
  targetValue: number;
  documentJson: object | null;
  /** ISO string of when the session actually started on the device */
  startedAt: string;
  /** Latest progress snapshot (updated on every save) */
  totalFocusedMinutes: number;
  lastPageIndex: number;
  pagesVisited: number;
  visitedPagesList: number[];
  /** True when the user pressed "End session" */
  completed: boolean;
  endedAt?: string;
}

export function getOfflineQueue(): OfflineSession[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveQueue(sessions: OfflineSession[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(sessions));
  } catch {
    // storage quota hit — drop oldest entry and retry
    const trimmed = sessions.slice(1);
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed)); } catch {}
  }
}

/** Save a new offline session and return its temporary ID. */
export function enqueueOfflineSession(
  data: Omit<OfflineSession, "tempId">
): string {
  const tempId = `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const queue = getOfflineQueue();
  queue.push({ ...data, tempId });
  saveQueue(queue);
  return tempId;
}

/** Update the progress snapshot for an existing queued session. */
export function updateOfflineSession(
  tempId: string,
  patch: Partial<Omit<OfflineSession, "tempId">>
) {
  const queue = getOfflineQueue();
  const idx = queue.findIndex((s) => s.tempId === tempId);
  if (idx >= 0) {
    queue[idx] = { ...queue[idx], ...patch };
    saveQueue(queue);
  }
}

function removeOfflineSession(tempId: string) {
  saveQueue(getOfflineQueue().filter((s) => s.tempId !== tempId));
}

/**
 * Sync all pending offline sessions to the server.
 * Should be called on app init and whenever the `online` event fires.
 * Returns the number of sessions successfully synced.
 */
export async function syncOfflineSessions(): Promise<number> {
  const queue = getOfflineQueue();
  if (queue.length === 0) return 0;

  let synced = 0;

  for (const session of queue) {
    try {
      // Create the session on the server with the original start time
      const createRes = await fetch("/api/study/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalType: session.goalType,
          targetValue: session.targetValue,
          documentJson: session.documentJson,
          startedAt: session.startedAt,
        }),
      });

      if (!createRes.ok) continue; // leave it in queue, retry later

      const { id: realId } = await createRes.json() as { id: string };

      // Move accumulated text from the temp key to the real session key
      try {
        const text = sessionStorage.getItem(`session-text-${session.tempId}`);
        if (text) {
          sessionStorage.setItem(`session-text-${realId}`, text);
          sessionStorage.removeItem(`session-text-${session.tempId}`);
        }
      } catch {}

      // Patch with final progress / completion
      if (session.totalFocusedMinutes > 0 || session.completed) {
        await fetch("/api/study/sessions", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: realId,
            totalFocusedMinutes: session.totalFocusedMinutes,
            lastPageIndex: session.lastPageIndex,
            pagesVisited: session.pagesVisited,
            visitedPagesList: session.visitedPagesList,
            ...(session.completed && session.endedAt
              ? { endedAt: session.endedAt }
              : {}),
          }),
        });
      }

      removeOfflineSession(session.tempId);
      synced++;

      // Let any listening components know so they can update their UI
      window.dispatchEvent(
        new CustomEvent("offlineSessionSynced", {
          detail: { tempId: session.tempId, realId },
        })
      );
    } catch {
      // Network still down — leave in queue
    }
  }

  return synced;
}

/** True if the temp ID looks like an offline session ID. */
export function isOfflineId(id: string) {
  return id.startsWith("offline-");
}
