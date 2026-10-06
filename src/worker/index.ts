import { warmUp } from "../engine/warm-up";
import { app } from "./app";
import type { AppBindings } from "./env";
import { logEvent } from "./logging";
import { cronSchedule, runMaintenance, taskForCron } from "./maintenance/tasks";
import { deleteExpiredShares } from "./repositories/shared-reports";

export { Scanner } from "./scanner";

try {
  warmUp();
} catch (error) {
  logEvent("warm_up_failed", { name: error instanceof Error ? error.name : "unknown" });
}

export default {
  fetch: app.fetch,
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
