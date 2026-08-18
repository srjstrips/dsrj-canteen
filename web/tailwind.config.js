/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#FAF9F6",
        card: "#FFFFFF",
        ink: "#1F2933",
        muted: "#6B7280",
        border: "#E7E2D9",
        primary: {
          DEFAULT: "#F97316",
          hover: "#EA580C",
          light: "#FFEDD5",
        },
        success: {
          DEFAULT: "#16A34A",
          light: "#DCFCE7",
        },
        danger: {
          DEFAULT: "#DC2626",
          light: "#FEE2E2",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(31, 41, 51, 0.06), 0 1px 3px rgba(31, 41, 51, 0.08)",
      },
    },
  },
  plugins: [],
};
