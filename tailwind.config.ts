import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      keyframes: {
        "boss-shake": {
          "0%, 100%": { transform: "translateX(0) rotate(0deg)" },
          "15%": { transform: "translateX(-10px) rotate(-4deg)" },
          "30%": { transform: "translateX(10px) rotate(4deg)" },
          "45%": { transform: "translateX(-7px) rotate(-2deg)" },
          "60%": { transform: "translateX(7px) rotate(2deg)" },
          "75%": { transform: "translateX(-3px)" },
        },
        "player-shake": {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-5px)" },
          "40%": { transform: "translateX(5px)" },
          "60%": { transform: "translateX(-5px)" },
          "80%": { transform: "translateX(5px)" },
        },
        "hp-flash": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.3" },
        },
        "player-attack": {
          "0%":   { transform: "translateX(0) rotate(0deg)" },
          "30%":  { transform: "translateX(30px) rotate(-20deg)" },
          "55%":  { transform: "translateX(60px) rotate(-35deg)" },
          "70%":  { transform: "translateX(20px) rotate(-10deg)" },
          "100%": { transform: "translateX(0) rotate(0deg)" },
        },
        "player-scribble": {
          "0%":   { transform: "translateX(0) rotate(0deg)" },
          "10%":  { transform: "translateX(-7px) rotate(-10deg)" },
          "20%":  { transform: "translateX(7px) rotate(10deg)" },
          "30%":  { transform: "translateX(-7px) rotate(-10deg)" },
          "40%":  { transform: "translateX(7px) rotate(10deg)" },
          "50%":  { transform: "translateX(-6px) rotate(-8deg)" },
          "60%":  { transform: "translateX(6px) rotate(8deg)" },
          "70%":  { transform: "translateX(-4px) rotate(-5deg)" },
          "80%":  { transform: "translateX(4px) rotate(5deg)" },
          "90%":  { transform: "translateX(-2px) rotate(-2deg)" },
          "100%": { transform: "translateX(0) rotate(0deg)" },
        },
        // ── spell attack animations ──
        "wand-raise": {
          "0%":   { transform: "rotate(-18deg)" },
          "100%": { transform: "rotate(-75deg)" },
        },
        "bolt-fly": {
          "0%":   { transform: "translateX(0)", opacity: "1" },
          "65%":  { opacity: "1" },
          "100%": { transform: "translateX(230px)", opacity: "0" },
        },
        "ink-fly": {
          "0%":   { transform: "translateX(0) scale(0.55)", opacity: "1" },
          "40%":  { transform: "translateX(90px) scale(1.15)", opacity: "1" },
          "100%": { transform: "translateX(230px) scale(0.25)", opacity: "0" },
        },
        "eraser-bounce": {
          "0%":   { transform: "translateX(0) translateY(0) rotate(0deg)", opacity: "1" },
          "22%":  { transform: "translateX(50px) translateY(-14px) rotate(18deg)" },
          "44%":  { transform: "translateX(100px) translateY(0) rotate(36deg)" },
          "66%":  { transform: "translateX(150px) translateY(-10px) rotate(54deg)" },
          "88%":  { transform: "translateX(200px) translateY(0) rotate(72deg)", opacity: "1" },
          "100%": { transform: "translateX(230px) translateY(0) rotate(80deg)", opacity: "0" },
        },
        "bolt-blocked": {
          "0%":   { transform: "translateX(0) scale(1)",      opacity: "1" },
          "32%":  { transform: "translateX(95px) scale(1)",   opacity: "1" },
          "42%":  { transform: "translateX(110px) scale(1.3)", opacity: "1" },
          "52%":  { transform: "translateX(90px) scale(0.75)", opacity: "1" },
          "100%": { transform: "translateX(-15px) scale(0.5)", opacity: "0" },
        },
        "boss-counter-fly": {
          "0%":   { transform: "translateX(0)", opacity: "1" },
          "70%":  { opacity: "1" },
          "100%": { transform: "translateX(-220px)", opacity: "0" },
        },
        "fade-up": {
          "0%":   { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "boss-shake":     "boss-shake 0.5s ease-in-out",
        "player-shake":   "player-shake 0.4s ease-in-out",
        "hp-flash":       "hp-flash 0.25s ease-in-out 2",
        "player-attack":  "player-attack 0.55s ease-in-out",
        "player-scribble":"player-scribble 0.5s ease-in-out",
        "wand-raise":     "wand-raise 0.2s ease-out forwards",
        "bolt-fly":       "bolt-fly 0.5s ease-in forwards",
        "ink-fly":        "ink-fly 0.55s ease-in-out forwards",
        "eraser-bounce":  "eraser-bounce 0.55s ease-in-out forwards",
        "bolt-blocked":   "bolt-blocked 0.65s linear forwards",
        "boss-counter-fly": "boss-counter-fly 0.55s ease-in forwards",
        // ── landing page ──
        "orbit-slow":     "spin 12s linear infinite",
        "orbit-slow-rev": "spin 12s linear infinite reverse",
        "orbit-med":      "spin 8s linear infinite",
        "orbit-med-rev":  "spin 8s linear infinite reverse",
        "fade-up":        "fade-up 0.6s ease-out forwards",
      },
    },
  },
  plugins: [],
};

export default config;
