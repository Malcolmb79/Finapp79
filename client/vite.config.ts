import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Vite's default host binds only to the IPv6 loopback ([::1]), not
    // 127.0.0.1 — but that's exactly the host registered as the Enable
    // Banking redirect URL (required by their Control Panel; see
    // .env.example), so without this the redirect back is "connection
    // refused" even though the dev server is genuinely running.
    host: true,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
