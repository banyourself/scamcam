export const dnsTypeA = 1;
const dnsClassIn = 1;
const headerBytes = 12;
const maxNameLength = 253;
const maxPointerSteps = 64;
const labelPattern = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/i;

export interface DnsReply {
  id: number;
  rcode: number;
  truncated: boolean;
  addresses: string[];
}

export function isDnsName(name: string): boolean {
  return name.length > 0 && name.length <= maxNameLength && name.split(".").every((label) => labelPattern.test(label));
}

export function encodeDnsQuery(id: number, name: string, recursionDesired = false): Uint8Array {
  if (!Number.isInteger(id) || id < 0 || id > 0xffff || !isDnsName(name)) {
    throw new RangeError("The DNS query is not valid");
  }
  const labels = name.split(".");
  const nameBytes = labels.reduce((total, label) => total + label.length + 1, 0) + 1;
  const bytes = new Uint8Array(headerBytes + nameBytes + 4);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, id);
  view.setUint16(2, recursionDesired ? 0x0100 : 0);
  view.setUint16(4, 1);
  let offset = headerBytes;
  for (const label of labels) {
    bytes[offset] = label.length;
    for (let index = 0; index < label.length; index += 1) {
      bytes[offset + 1 + index] = label.charCodeAt(index);
    }
    offset += label.length + 1;
  }
  offset += 1;
  view.setUint16(offset, dnsTypeA);
  view.setUint16(offset + 2, dnsClassIn);
  return bytes;
}

function skipName(bytes: Uint8Array, start: number): number {
  let offset = start;
  for (let step = 0; step < maxPointerSteps; step += 1) {
    if (offset >= bytes.length) {
      return -1;
    }
    const length = bytes[offset]!;
    if (length === 0) {
      return offset + 1;
    }
    if ((length & 0xc0) === 0xc0) {
      return offset + 2 <= bytes.length ? offset + 2 : -1;
    }
    if ((length & 0xc0) !== 0) {
      return -1;
    }
    offset += length + 1;
  }
  return -1;
}

export function decodeDnsReply(bytes: Uint8Array): DnsReply | null {
  if (bytes.length < headerBytes) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = view.getUint16(2);
  if ((flags & 0x8000) === 0) {
    return null;
  }
  const questions = view.getUint16(4);
  const answers = view.getUint16(6);
  let offset = headerBytes;
  for (let index = 0; index < questions; index += 1) {
    offset = skipName(bytes, offset);
    if (offset < 0 || offset + 4 > bytes.length) {
      return null;
    }
    offset += 4;
  }
  const addresses: string[] = [];
  for (let index = 0; index < answers; index += 1) {
    offset = skipName(bytes, offset);
    if (offset < 0 || offset + 10 > bytes.length) {
      return null;
    }
    const type = view.getUint16(offset);
    const recordClass = view.getUint16(offset + 2);
    const length = view.getUint16(offset + 8);
    offset += 10;
    if (offset + length > bytes.length) {
      return null;
    }
    if (type === dnsTypeA && recordClass === dnsClassIn && length === 4) {
      addresses.push([...bytes.subarray(offset, offset + 4)].join("."));
    }
    offset += length;
  }
  return { id: view.getUint16(0), rcode: flags & 0x0f, truncated: (flags & 0x0200) !== 0, addresses };
}
