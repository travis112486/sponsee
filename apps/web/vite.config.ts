import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // SPO-241: pin framer-motion to one chunk of its own.
        //
        // Left to itself Rollup duplicates the animation engine. After the
        // LazyMotion split it emitted a copy in `index-*.js` (for the shell's
        // MotionProvider) AND another in `Dashboard-*.js` (for the route's own
        // `motion.*` elements) — ~69 kB of the same code twice, and every
        // further route that animates would have added another copy. Naming the
        // chunk makes it one shared, separately-cacheable module fetched once.
        manualChunks: {
          motion: ["framer-motion"],
        },
      },
    },
  },
});
