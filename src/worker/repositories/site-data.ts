import type { SiteDataset } from "../../shared/site-data";

export interface StoredDataset {
  version: string;
  builtAt: number;
  bytes: Uint8Array<ArrayBuffer>;
}

interface PartRow {
  version: string;
  parts: number;
  bytes: number;
  built_at: number;
  part: number;
  body: string;
}

export async function readDataset(db: D1Database, dataset: SiteDataset): Promise<StoredDataset | null> {
  const { results } = await db
    .prepare(
      "SELECT d.version, d.parts, d.bytes, d.built_at, p.part, p.body FROM site_data d JOIN site_data_parts p ON p.dataset = d.dataset AND p.version = d.version WHERE d.dataset = ? ORDER BY p.part",
    )
    .bind(dataset)
    .all<PartRow>();
  const first = results[0];
  if (!first || results.length !== first.parts || results.some((row, index) => row.part !== index)) {
    return null;
  }
  const binary = atob(results.map((row) => row.body).join(""));
  if (binary.length !== first.bytes) {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { version: first.version, builtAt: first.built_at, bytes };
}
