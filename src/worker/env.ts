export interface AppBindings extends Env {
  TURNSTILE_SECRET_KEY?: string;
}

export interface AppVariables {
  requestId: string;
}

export interface AppEnv {
  Bindings: AppBindings;
  Variables: AppVariables;
}
