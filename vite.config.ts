import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare({ remoteBindings: process.env.SCAMCAM_LOCAL_ONLY !== "1" })],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/client", import.meta.url)) },
  },
  build: {
    sourcemap: false,
  },
});
