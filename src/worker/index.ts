import { app } from "./app";
import type { AppBindings } from "./env";
import { logEvent } from "./logging";
import { runMaintenance, taskForCron } from "./maintenance/tasks";

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
