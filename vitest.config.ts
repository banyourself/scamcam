import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
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
    include: ["test/worker/**/*.test.ts"],
    setupFiles: ["./test/worker/apply-migrations.ts"],
  },
});
