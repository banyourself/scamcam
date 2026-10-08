import { breachCatalogFreshSeconds, breachIndex, catalogAgeSeconds, catalogIsUsable, fetchBreachCatalog, type BreachIndex } from "../engine/breach-catalog";
import type { BreachCatalog } from "../shared/api";
import { isBreachCatalog } from "../shared/breaches";

export const breachStorageKey = "breach-catalog";

export interface CatalogStorage {
  get(key: string): Promise<unknown>;
  put(key: string, value: BreachCatalog): Promise<void>;
}

export class BreachKeeper {
  private readonly storage: CatalogStorage;
  private readonly fetcher: typeof fetch;
  private readonly clock: () => number;
  private catalog: BreachCatalog | null | undefined;
  private loading: Promise<BreachCatalog | null> | null = null;
  private indexed: { fetchedAt: string; index: BreachIndex } | null = null;

  constructor(storage: CatalogStorage, fetcher: typeof fetch, clock: () => number = Date.now) {
    this.storage = storage;
    this.fetcher = fetcher;
    this.clock = clock;
  }

  async stored(): Promise<BreachCatalog | null> {
    if (this.catalog === undefined) {
      const value = await this.storage.get(breachStorageKey).catch(() => undefined);
      this.catalog ??= isBreachCatalog(value) ? value : null;
    }
    return this.catalog;
  }

  async current(): Promise<BreachCatalog | null> {
    const stored = await this.stored();
    if (stored && catalogAgeSeconds(stored, this.clock()) < breachCatalogFreshSeconds) {
      return stored;
    }
    this.loading ??= this.refresh(stored).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  async index(): Promise<BreachIndex | undefined> {
    const stored = await this.stored();
    if (!stored || !catalogIsUsable(stored, this.clock())) {
      return undefined;
    }
    if (this.indexed?.fetchedAt !== stored.fetchedAt) {
      this.indexed = { fetchedAt: stored.fetchedAt, index: breachIndex(stored) };
    }
    return this.indexed.index;
  }

  private async refresh(stored: BreachCatalog | null): Promise<BreachCatalog | null> {
    const fetched = await fetchBreachCatalog(this.fetcher, new Date(this.clock()));
    if (!fetched) {
      return stored && catalogIsUsable(stored, this.clock()) ? stored : null;
    }
    this.catalog = fetched;
    await this.storage.put(breachStorageKey, fetched).catch(() => undefined);
    return fetched;
  }
}
