import type { TextModel } from "../engine/ai-review";
import type { Lookups } from "../engine/cache";

export type AppBindings = Env;

export interface AppVariables {
  requestId: string;
  fetcher: typeof fetch;
  lookups: Lookups;
  aiModel: TextModel | null;
}

export interface AppEnv {
  Bindings: AppBindings;
  Variables: AppVariables;
}
