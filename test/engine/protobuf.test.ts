import { describe, expect, it } from "vitest";
import { readMessage, readPackedVarints } from "../../src/engine/protobuf";

describe("protobuf reader", () => {
  it("reads varints and length-delimited fields and skips fixed-width ones", () => {
    const bytes = new Uint8Array([0x08, 0xac, 0x02, 0x12, 0x02, 0x68, 0x69, 0x19, 1, 2, 3, 4, 5, 6, 7, 8, 0x25, 1, 2, 3, 4, 0x28, 0x01]);
    expect(readMessage(bytes)).toEqual([
      { field: 1, value: 300n },
      { field: 2, value: new Uint8Array([0x68, 0x69]) },
      { field: 5, value: 1n },
    ]);
  });

  it("reads packed varints", () => {
    expect(readPackedVarints(new Uint8Array([0x01, 0xac, 0x02, 0x02]))).toEqual([1n, 300n, 2n]);
  });

  it("reads an empty message", () => {
    expect(readMessage(new Uint8Array())).toEqual([]);
  });

  it.each([
    ["an unfinished varint", [0x08, 0xff]],
    ["a varint longer than ten bytes", [0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]],
    ["a length past the end", [0x12, 0x05, 0x00]],
    ["field number zero", [0x00, 0x01]],
    ["a group start", [0x0b]],
    ["a group end", [0x0c]],
    ["a cut-off fixed64 field", [0x09, 0x00]],
    ["a cut-off fixed32 field", [0x0d, 0x00]],
  ])("rejects %s", (_, bytes) => {
    expect(() => readMessage(new Uint8Array(bytes))).toThrow(RangeError);
  });
});
