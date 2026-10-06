import { createReadStream, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { ocrBase, ocrFiles } from "./src/shared/ocr.ts";

const fromModules = (path: string) => fileURLToPath(new URL(`./node_modules/${path}`, import.meta.url));

function ocrAssets(): Plugin {
  const published = new Map(Object.entries(ocrFiles).map(([file, source]) => [`${ocrBase}/${file}`, fromModules(source)]));
  return {
    name: "scamcam-ocr-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const source = published.get((request.url ?? "").split("?")[0] ?? "");
        if (!source) {
          next();
          return;
        }
        response.setHeader("Content-Type", source.endsWith(".gz") ? "application/gzip" : source.endsWith(".js") ? "text/javascript" : "text/plain; charset=utf-8");
        createReadStream(source).pipe(response);
      });
    },
    generateBundle() {
      if (this.environment.name !== "client") {
        return;
      }
      for (const [path, source] of published) {
        this.emitFile({ type: "asset", fileName: path.slice(1), source: readFileSync(source) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ocrAssets(), cloudflare({ remoteBindings: process.env.SCAMCAM_LOCAL_ONLY !== "1" })],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/client", import.meta.url)) },
  },
  build: {
    sourcemap: false,
  },
});
