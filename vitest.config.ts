import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Full UI flow tests (render -> cart -> checkout) can exceed 5s on loaded CI runners.
    testTimeout: 15_000,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    env: {
      // Disable Supabase in tests so all store actions use the local fallback.
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
