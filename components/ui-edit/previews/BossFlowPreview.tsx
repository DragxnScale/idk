"use client";

/**
 * Static preview of all Boss Beacons / exit gate phases for the admin UI editor.
 * No API calls — renders mock data for every phase so all SuiText nodes are
 * accessible for right-click editing.
 */

import { SuiText } from "@/components/ui-copy/UiCopyProvider";

const MOCK_BOSS = {
  name: "Tab Wraith",
  emoji: "👻",
  taunt: "One peek won't hurt… right?",
  colorClass: "from-purple-900 to-indigo-900",
};

export function BossFlowPreview() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 space-y-6">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
        Boss Beacons — all phases (right-click any text to edit)
      </p>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">

        {/* ── Trigger button ── */}
        <PhaseCard title="Trigger button">
          <button
            type="button"
            className="rounded border border-red-500/40 px-3 py-1.5 text-sm text-red-600 dark:text-red-400"
          >
            <SuiText page="exit-boss" k="btn.end-session" def="End Session" as="span" />
          </button>
        </PhaseCard>

        {/* ── Confirm off (Boss Beacons disabled) ── */}
        <PhaseCard title="Confirm (gate off)">
          <h2 className="text-base font-semibold mb-1">
            <SuiText page="exit-boss" k="confirm.title" def="End session?" as="span" />
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            <SuiText page="exit-boss" k="confirm.subtitle" def="Progress will be saved." as="span" />
          </p>
          <div className="flex gap-2">
            <button type="button" className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600">
              <SuiText page="exit-boss" k="btn.keep-studying" def="Keep studying" as="span" />
            </button>
            <button type="button" className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white">
              <SuiText page="exit-boss" k="btn.end-session-confirm" def="End session" as="span" />
            </button>
          </div>
        </PhaseCard>

        {/* ── Cooldown ── */}
        <PhaseCard title="Cooldown">
          <h2 className="text-base font-semibold mb-3">
            <SuiText page="exit-boss" k="cooldown.heading" def="Boss Beacons" as="span" />
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            <SuiText page="exit-boss" k="cooldown.text" def="Exit runway charging… take a breath before you go." as="span" />
          </p>
          <div className="mt-3 h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
            <div className="h-full w-2/3 rounded-full bg-amber-500" />
          </div>
          <p className="text-center text-3xl font-bold tabular-nums text-amber-600 dark:text-amber-400 mt-3">7s</p>
          <button type="button" className="mt-3 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600">
            <SuiText page="exit-boss" k="btn.keep-studying" def="Keep studying" as="span" />
          </button>
        </PhaseCard>

        {/* ── Loading ── */}
        <PhaseCard title="Loading bosses">
          <p className="text-sm text-gray-500 dark:text-gray-400 animate-pulse py-8 text-center">
            <SuiText page="exit-boss" k="loading.text" def="Summoning distraction sprites…" as="span" />
          </p>
        </PhaseCard>

        {/* ── Boss fight ── */}
        <PhaseCard title="Boss fight">
          <h2 className="text-base font-semibold mb-3">
            <SuiText page="exit-boss" k="boss.heading" def="Boss Beacon" as="span" />
          </h2>
          <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${MOCK_BOSS.colorClass} shadow-lg`} style={{ minHeight: "11rem" }}>
            <div className="pointer-events-none absolute inset-0 bg-black/30" />
            <div className="relative z-10 flex items-end justify-between px-5 pb-4 pt-5">
              <div className="flex flex-col items-center gap-1 select-none">
                <div className="w-12 h-16 rounded bg-white/10" />
                <span className="text-white/60 text-[9px] font-bold tracking-widest uppercase">You</span>
              </div>
              <div className="flex flex-col items-center gap-0.5 text-white">
                <div className="text-6xl leading-none">{MOCK_BOSS.emoji}</div>
                <h3 className="text-base font-extrabold tracking-wide drop-shadow">{MOCK_BOSS.name}</h3>
                <p className="text-[10px] italic opacity-70 max-w-[140px] text-center leading-tight">
                  &ldquo;{MOCK_BOSS.taunt}&rdquo;
                </p>
              </div>
            </div>
            <div className="relative z-10 px-5 pb-4">
              <div className="mb-1 flex justify-between text-[10px] font-bold text-white/80">
                <span><SuiText page="exit-boss" k="boss.hp-label" def="BOSS HP" as="span" /></span>
                <span>72%</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-black/50">
                <div className="h-full w-[72%] rounded-full bg-green-400 transition-all duration-700" />
              </div>
            </div>
          </div>
          <div className="mt-3">
            <p className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
              What is the main topic covered on page 12?
            </p>
            <div className="grid gap-2">
              {["Photosynthesis", "Cellular respiration", "Mitosis", "DNA replication"].map((opt, i) => (
                <button key={i} type="button" className="rounded-xl border border-gray-300 px-3 py-2.5 text-left text-sm font-medium dark:border-gray-600">
                  <span className="mr-2 font-mono text-xs text-gray-400">{["A", "B", "C", "D"][i]}</span>
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-500 dark:border-gray-600 dark:text-gray-400">
            <SuiText page="exit-boss" k="btn.keep-studying" def="Keep studying" as="span" />
          </button>
        </PhaseCard>

        {/* ── Phrase gate ── */}
        <PhaseCard title="Phrase gate">
          <h2 className="text-base font-semibold mb-1">
            <SuiText page="exit-boss" k="phrase.heading" def="Unlock the exit" as="span" />
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            <SuiText page="exit-boss" k="phrase.instructions" def="Type this phrase exactly — including capitalization — to unlock the exit." as="span" />
          </p>
          <p className="mt-3 rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-center font-mono text-sm font-semibold select-all">
            focus unlocks potential
          </p>
          <input
            type="text"
            readOnly
            placeholder="Type the phrase above"
            className="mt-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-mono dark:border-gray-600 dark:bg-gray-800"
          />
          <div className="mt-3 flex gap-2">
            <button type="button" className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600">
              <SuiText page="exit-boss" k="btn.keep-studying" def="Keep studying" as="span" />
            </button>
            <button type="button" className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white">
              <SuiText page="exit-boss" k="btn.end-session-confirm" def="End session" as="span" />
            </button>
          </div>
          <div className="mt-3 flex gap-2 opacity-60">
            <button type="button" className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600">
              <SuiText page="exit-boss" k="btn.keep-studying" def="Keep studying" as="span" />
            </button>
            <button type="button" className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white opacity-50">
              <SuiText page="exit-boss" k="phrase.btn.checking" def="Checking…" as="span" />
            </button>
          </div>
        </PhaseCard>

        {/* ── Victory ── */}
        <PhaseCard title="Victory">
          <div className="text-center py-6">
            <p className="text-4xl mb-2">✨</p>
            <h2 className="text-lg font-bold text-green-600 dark:text-green-400">
              <SuiText page="exit-boss" k="victory.title" def="Beacon secured!" as="span" />
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              <SuiText page="exit-boss" k="victory.subtitle" def="Landing the session…" as="span" />
            </p>
          </div>
        </PhaseCard>

      </div>
    </div>
  );
}

function PhaseCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900 max-h-[90vh] overflow-y-auto">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">{title}</p>
      {children}
    </div>
  );
}
