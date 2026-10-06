export interface Deadline {
  signal: AbortSignal;
  clear(): void;
}

export function deadline(milliseconds: number): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("The operation timed out", "TimeoutError")), milliseconds);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}
