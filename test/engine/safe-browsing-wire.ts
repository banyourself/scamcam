const threatTypeNumbers: Record<string, number> = {
  MALWARE: 1,
  SOCIAL_ENGINEERING: 2,
  UNWANTED_SOFTWARE: 3,
  POTENTIALLY_HARMFUL_APPLICATION: 4,
};

const attributeNumbers: Record<string, number> = {
  THREAT_ATTRIBUTE_UNSPECIFIED: 0,
  CANARY: 1,
  FRAME_ONLY: 2,
};

export interface SearchResponseFixture {
  fullHashes?: { fullHash: string; fullHashDetails?: { threatType: string; attributes?: string[] }[] }[];
  cacheSeconds?: number;
}

function varint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  bytes.push(rest);
  return bytes;
}

function varintField(field: number, value: number): number[] {
  return [...varint(field * 8), ...varint(value)];
}

function bytesField(field: number, payload: number[]): number[] {
  return [...varint(field * 8 + 2), ...varint(payload.length), ...payload];
}

export function fromHex(text: string): Uint8Array {
  return Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

export function encodeSearchResponse(fixture: SearchResponseFixture): Uint8Array {
  const bytes: number[] = [];
  for (const entry of fixture.fullHashes ?? []) {
    const hash = [...Uint8Array.from(atob(entry.fullHash), (char) => char.charCodeAt(0))];
    const details = (entry.fullHashDetails ?? []).flatMap((detail) =>
      bytesField(2, [
        ...varintField(1, threatTypeNumbers[detail.threatType] ?? 0),
        ...(detail.attributes?.length ? bytesField(2, detail.attributes.flatMap((attribute) => varint(attributeNumbers[attribute] ?? 0))) : []),
      ]),
    );
    bytes.push(...bytesField(1, [...bytesField(1, hash), ...details]));
  }
  if (fixture.cacheSeconds !== undefined) {
    bytes.push(...bytesField(2, varintField(1, fixture.cacheSeconds)));
  }
  return new Uint8Array(bytes);
}

export function protobufResponse(body: SearchResponseFixture | Uint8Array, status = 200): Response {
  const bytes = new Uint8Array(body instanceof Uint8Array ? body : encodeSearchResponse(body));
  return new Response(bytes, { status, headers: { "Content-Type": "application/x-protobuf" } });
}
