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

/** Themed counter-attack when the player answers wrong during the exit fight. */
export interface BossCounterAttack {
  name: string;
  /** Shown when the boss lands a hit on the player. */
  message: string;
}

export const BOSS_COUNTER_ATTACKS: Record<string, BossCounterAttack[]> = {
  tab_wraith: [
    { name: "Phantom Peek", message: "A ghostly tab pulls your eyes away…" },
    { name: "Alt-Tab Curse", message: "Something else might be more interesting…" },
  ],
  scroll_serpent: [
    { name: "Infinite Scroll", message: "Just one more swipe — you deserve a break." },
    { name: "Feed Trance", message: "The serpent coils around your focus." },
  ],
  phone_goblin: [
    { name: "Notification Blast", message: "Buzz! Someone needs you right now." },
    { name: "Doom Scroll", message: "Your feed knows you better than this chapter." },
  ],
  snooze_slime: [
    { name: "Nap Wave", message: "You've earned a rest… close the book." },
    { name: "Heavy Eyelids", message: "The slime whispers: five more minutes." },
  ],
};

export function randomBossCounterAttack(bossKey: string): BossCounterAttack {
  const list = BOSS_COUNTER_ATTACKS[bossKey] ?? BOSS_COUNTER_ATTACKS.tab_wraith;
  return list[Math.floor(Math.random() * list.length)];
}

export const PLAYER_MAX_HP = 100;
/** HP lost per wrong answer (randomized slightly for variance). */
export function randomPlayerDamage(): number {
  return 28 + Math.floor(Math.random() * 13); // 28–40
}

export type ExitMethod =
  | "goal_reached"
  | "boss_cleared"
  | "phrase_fallback"
  | "gate_off"
  | "offline";
