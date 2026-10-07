import { describe, expect, it } from "vitest";
import { memoryLookups } from "../../src/engine/cache";
import { lookupHost } from "../../src/engine/dns";
import { readLimitedJson, ResponseTooLargeError } from "../../src/engine/limited-body";

function streamed(text: string, chunk = 1024): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset += chunk;
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/json" } });
}

describe("limited provider responses", () => {
  it("reads a normal answer", async () => {
    expect(await readLimitedJson(Response.json({ ok: true }), 1024)).toEqual({ ok: true });
  });

  it("refuses an answer whose declared size is too large without reading it", async () => {
    const response = new Response("{}", { headers: { "Content-Length": "999999" } });
    await expect(readLimitedJson(response, 1024)).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it("stops reading a streamed answer as soon as it passes the limit", async () => {
    const huge = JSON.stringify({ padding: "x".repeat(10_000) });
    await expect(readLimitedJson(streamed(huge), 4096)).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it("treats an oversized DNS answer as no answer", async () => {
    const answers = Array.from({ length: 3000 }, (_, index) => ({ type: 1, data: `203.0.113.${index % 255}`, TTL: 60 }));
    const result = await lookupHost("big.example", async () => streamed(JSON.stringify({ Status: 0, Answer: answers })), memoryLookups());
    expect(result).toEqual({ status: "unavailable" });
  });
});
