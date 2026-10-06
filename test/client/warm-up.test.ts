import { describe, expect, it } from "vitest";
import { warmUp } from "../../src/engine/warm-up";

describe("startup warm-up", () => {
  it("runs the analysis code once without throwing, quickly enough for startup", () => {
    const started = performance.now();
    expect(() => warmUp()).not.toThrow();
    expect(performance.now() - started).toBeLessThan(500);
  });
});
