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
      },
      animation: {
        "boss-shake": "boss-shake 0.5s ease-in-out",
        "player-shake": "player-shake 0.4s ease-in-out",
        "hp-flash": "hp-flash 0.25s ease-in-out 2",
        "player-attack": "player-attack 0.55s ease-in-out",
        "player-scribble": "player-scribble 0.5s ease-in-out",
      },
    },
  },
  plugins: [],
};

export default config;
