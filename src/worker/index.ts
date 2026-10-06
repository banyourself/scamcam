import { warmUp } from "../engine/warm-up";
import { app } from "./app";
import type { AppBindings } from "./env";
import { logEvent } from "./logging";
import { runMaintenance, taskForCron } from "./maintenance/tasks";

try {
  warmUp();
} catch (error) {
  logEvent("warm_up_failed", { name: error instanceof Error ? error.name : "unknown" });
}

export default {
  fetch: app.fetch,
  scheduled(controller, env, ctx) {
    const task = taskForCron(controller.cron);
    if (!task) {
      logEvent("maintenance", { status: "skipped", reason: "unknown_schedule" });
      return;
    }
    ctx.waitUntil(runMaintenance(task, env));
  },
} satisfies ExportedHandler<AppBindings>;
