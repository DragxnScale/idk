/**
 * Boss personas for the exit gate minigame.
 */

export const EXIT_BOSS_COUNT = 3;
export const EXIT_COOLDOWN_SEC = 20;

export interface BossPersona {
  key: string;
  name: string;
  taunt: string;
  /** Tailwind color classes for the boss avatar */
  colorClass: string;
  emoji: string;
}

export const BOSS_ROSTER: BossPersona[] = [
  {
    key: "tab_wraith",
    name: "Tab Wraith",
    taunt: "One peek won't hurt… right?",
    colorClass: "from-violet-600 to-indigo-800",
    emoji: "👻",
  },
  {
    key: "scroll_serpent",
    name: "Scroll Serpent",
    taunt: "Just five more minutes of nothing.",
    colorClass: "from-emerald-600 to-teal-900",
    emoji: "🐍",
  },
  {
    key: "phone_goblin",
    name: "Phone Goblin",
    taunt: "Someone liked your post. Surely you need to check.",
    colorClass: "from-amber-500 to-orange-700",
    emoji: "📱",
  },
  {
    key: "snooze_slime",
    name: "Snooze Slime",
    taunt: "You've read enough for today, right?",
    colorClass: "from-sky-500 to-blue-800",
    emoji: "💤",
  },
];

export function bossForIndex(index: number): BossPersona {
  return BOSS_ROSTER[index % BOSS_ROSTER.length];
}

export type ExitMethod =
  | "goal_reached"
  | "boss_cleared"
  | "phrase_fallback"
  | "gate_off"
  | "offline";
