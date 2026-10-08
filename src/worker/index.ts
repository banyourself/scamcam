import { warmUp } from "../engine/warm-up";
import { app } from "./app";
import type { AppBindings } from "./env";
import { logEvent } from "./logging";
import { servePage } from "./pages";
import { cronSchedule, runMaintenance, taskForCron } from "./maintenance/tasks";
import { deleteExpiredShares } from "./repositories/shared-reports";

export { Scanner } from "./scanner";

try {
  warmUp();
} catch (error) {
  logEvent("warm_up_failed", { name: error instanceof Error ? error.name : "unknown" });
}

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    if (import.meta.env.DEV) {
      return env.ASSETS.fetch(request);
    }
    return servePage(request, env.ASSETS);
  },
  scheduled(controller, env, ctx) {
    if (controller.cron === cronSchedule.shares) {
      ctx.waitUntil(
        deleteExpiredShares(env.DB).catch((error: unknown) => {
          logEvent("alert", { task: "shares", alert: "share_cleanup_failed", reason: error instanceof Error ? error.name : "unknown" });
        }),
      );
      return;
    }
    const task = taskForCron(controller.cron);
    if (!task) {
      logEvent("maintenance", { status: "skipped", reason: "unknown_schedule" });
      return;
    }
    ctx.waitUntil(runMaintenance(task, env));
  },
} satisfies ExportedHandler<AppBindings>;
