/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Sponsee brand palette
        paper: "#F7F5F1",
        surface: {
          DEFAULT: "#FFFFFF",
          subtle: "#FBFAF7",
        },
        ink: {
          DEFAULT: "#1B1815",
          2: "#57504A",
          3: "#757069",
        },
        hairline: "#E8E3DB",
        pine: {
          DEFAULT: "#0E7A5F",
          hover: "#0B664F",
          tint: "#E4F1EB",
        },
        amber: {
          DEFAULT: "#B87208",
          tint: "#FAF0DC",
        },
        brick: {
          DEFAULT: "#B3402A",
          tint: "#F9E7E1",
        },
        twitch: "#8B5CF6",
        youtube: "#E5484D",
        kick: "#58A617",
        // TikTok's own brand mark is black; ink keeps it inside the warm set
        // instead of importing the neon cyan/magenta (SPO-193).
        tiktok: "#1B1815",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["'Instrument Serif'", "Georgia", "serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        warm: "0 1px 2px rgba(27,24,21,.05)",
        "warm-md": "0 4px 16px rgba(27,24,21,.08), 0 1px 3px rgba(27,24,21,.06)",
        "warm-lg": "0 12px 40px rgba(27,24,21,.14)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [import("tailwindcss-animate")],
};
