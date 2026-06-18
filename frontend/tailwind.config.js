/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        base: "#030303",
        surface: "#0A0A0A",
        elevated: "#121212",
        hair: "#1C1C1C",
        focus: "#333333",
        ink: "#FFFFFF",
        sub: "#8A8F98",
        faint: "#4A4D54",
        live: "#FF3B30",
        warn: "#FFB000",
        verified: "#00E5FF",
      },
      fontFamily: {
        head: ['"Cabinet Grotesk"', "sans-serif"],
        body: ['"Outfit"', "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      keyframes: {
        pulse2: {
          "0%,100%": { opacity: 1, transform: "scale(1)" },
          "50%": { opacity: 0.35, transform: "scale(0.7)" },
        },
        drift: {
          "0%": { transform: "translateY(0)" },
          "100%": { transform: "translateY(-40px)" },
        },
      },
      animation: {
        pulse2: "pulse2 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
