import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.join(import.meta.dirname, "src"),
      // server-only throws outside the react-server condition, as in every Vitest run.
      "server-only": path.join(import.meta.dirname, "src/testing/server-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/__tests__/*.test.{ts,tsx}"],
    setupFiles: ["src/testing/setup.ts"],
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      KNOWNO_SERVICE_ORIGIN: "http://localhost:3000",
    },
  },
});
