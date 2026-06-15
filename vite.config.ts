import { defineConfig } from 'vite';

// Standalone deploy of the game; embedded by the Old Games desktop shell via an
// <iframe>. No base path — it's served from the root of its own Pages project.
export default defineConfig({
  // Distinct dev port (chips-challenge-web uses 5173) so both games can run
  // alongside the desktop shell in development.
  server: { port: 5180 },
  build: { target: 'es2020' },
});
