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
      },
      animation: {
        "boss-shake": "boss-shake 0.5s ease-in-out",
        "player-shake": "player-shake 0.4s ease-in-out",
        "hp-flash": "hp-flash 0.25s ease-in-out 2",
      },
    },
  },
  plugins: [],
};

export default config;
