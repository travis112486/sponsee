// Vitest setup file: runs before any test module is loaded.
// Forces PGlite into in-memory mode so test files don't race on disk.
process.env.VERCEL = "1";
