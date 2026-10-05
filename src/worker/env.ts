export type AppBindings = Env;

export interface AppVariables {
  requestId: string;
  fetcher: typeof fetch;
}

export interface AppEnv {
  Bindings: AppBindings;
  Variables: AppVariables;
}
