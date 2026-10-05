import { useEffect, useState } from "react";
import type { HealthResponse } from "../../shared/api";

export type ApiHealth = { state: "checking" } | { state: "online"; health: HealthResponse } | { state: "offline" };

export function useApiHealth(): ApiHealth {
  const [status, setStatus] = useState<ApiHealth>({ state: "checking" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/health", { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("unavailable");
        }
        setStatus({ state: "online", health: (await response.json()) as HealthResponse });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStatus({ state: "offline" });
        }
      });
    return () => controller.abort();
  }, []);

  return status;
}
