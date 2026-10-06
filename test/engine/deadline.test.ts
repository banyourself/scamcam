import { describe, expect, it } from "vitest";
import { deadline } from "../../src/engine/deadline";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

describe("deadline", () => {
  it("aborts when the time runs out", async () => {
    const timer = deadline(5);
    await wait(40);
    expect(timer.signal.aborted).toBe(true);
    expect((timer.signal.reason as DOMException).name).toBe("TimeoutError");
  });

  it("never fires once cleared, so no timer outlives the lookup", async () => {
    const timer = deadline(5);
    timer.clear();
    await wait(40);
    expect(timer.signal.aborted).toBe(false);
  });
});
