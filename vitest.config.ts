import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest(async () => ({
            remoteBindings: false,
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations("./migrations"),
                TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
              },
            },
          })),
        ],
        test: {
          name: "worker",
          include: ["test/worker/**/*.test.ts", "test/engine/**/*.test.ts"],
          setupFiles: ["./test/worker/apply-migrations.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias: { "@": fileURLToPath(new URL("./src/client", import.meta.url)) } },
        test: {
          name: "client",
          environment: "node",
          include: ["test/client/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
