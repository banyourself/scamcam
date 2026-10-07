import { describe, expect, it } from "vitest";
import { toBase64Url } from "../../src/shared/base64url";
import { maxInputLength } from "../../src/shared/extract";
import { decodeHandoff } from "../../src/client/lib/handoff";

const encode = (text: string) => "#check=" + toBase64Url(new TextEncoder().encode(text));

describe("decodeHandoff", () => {
  it("reads text the extension puts after #check=", () => {
    expect(decodeHandoff(encode("free nitro at https://dlscord-gift.example/claim"))).toBe(
      "free nitro at https://dlscord-gift.example/claim",
    );
    expect(decodeHandoff(encode("Привет, вот ссылка 🎁"))).toBe("Привет, вот ссылка 🎁");
  });

  it("drops control characters, trims, and caps the length", () => {
    expect(decodeHandoff(encode("  hi\u0000\u0007 there\n"))).toBe("hi there");
    expect(decodeHandoff(encode("x".repeat(maxInputLength + 50)))?.length).toBe(maxInputLength);
  });

  it("ignores anything that is not a clean hand-off", () => {
    expect(decodeHandoff("#check=")).toBeNull();
    expect(decodeHandoff("#check=not base64!")).toBeNull();
    expect(decodeHandoff("#about")).toBeNull();
    expect(decodeHandoff("#check=" + toBase64Url(new Uint8Array([0xff, 0xfe, 0xfd])))).toBeNull();
    expect(decodeHandoff(encode("   "))).toBeNull();
    expect(decodeHandoff("#check=" + "A".repeat(20000))).toBeNull();
  });
});
