import type { Lookups } from "../engine/cache";

export type AppBindings = Env;

export interface AppVariables {
  requestId: string;
  fetcher: typeof fetch;
  lookups: Lookups;
}

export interface AppEnv {
  Bindings: AppBindings;
  Variables: AppVariables;
}
