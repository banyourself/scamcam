export interface WireField {
  field: number;
  value: bigint | Uint8Array;
}

function readVarint(bytes: Uint8Array, offset: number): [bigint, number] {
  let value = 0n;
  for (let index = 0; index < 10; index += 1) {
    const byte = bytes[offset + index];
    if (byte === undefined) {
      break;
    }
    value |= BigInt(byte & 0x7f) << BigInt(7 * index);
    if (byte < 0x80) {
      return [value, offset + index + 1];
    }
  }
  throw new RangeError("Malformed protobuf varint");
}

export function readMessage(bytes: Uint8Array): WireField[] {
  const fields: WireField[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const [tag, afterTag] = readVarint(bytes, offset);
    const field = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    if (field === 0) {
      throw new RangeError("Malformed protobuf field number");
    }
    if (wireType === 0) {
      const [value, next] = readVarint(bytes, afterTag);
      fields.push({ field, value });
      offset = next;
    } else if (wireType === 2) {
      const [length, start] = readVarint(bytes, afterTag);
      if (length > BigInt(bytes.length - start)) {
        throw new RangeError("Truncated protobuf field");
      }
      offset = start + Number(length);
      fields.push({ field, value: bytes.subarray(start, offset) });
    } else if (wireType === 1 || wireType === 5) {
      offset = afterTag + (wireType === 1 ? 8 : 4);
      if (offset > bytes.length) {
        throw new RangeError("Truncated protobuf field");
      }
    } else {
      throw new RangeError("Unsupported protobuf wire type");
    }
  }
  return fields;
}

export function readPackedVarints(bytes: Uint8Array): bigint[] {
  const values: bigint[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const [value, next] = readVarint(bytes, offset);
    values.push(value);
    offset = next;
  }
  return values;
}
