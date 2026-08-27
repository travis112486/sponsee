// Vitest setup file — runs BEFORE any test imports are evaluated.
// Forces PGlite into in-memory mode so every test worker shares one instance.
process.env.VERCEL = "1";
