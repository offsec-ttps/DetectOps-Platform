/**
 * IngestorRegistry — ported from magicsword-io/Magic-Atomics
 * backend/app/ingestion/registry.py. Central discovery point for all LOTL
 * source ingestors. Register a new source here and it becomes available to the
 * sync engine, the library list, and the API.
 *
 * Phase 3 ships LOLBAS + GTFOBins; the remaining Magic-Atomics sources
 * (loldrivers, lolrmm, loobins, lolapi, loltunnels, persistence-info, loas,
 * sysinternals) are added in Phase 6 by registering their ingestors here.
 */

import type { LotlIngestor } from "./base";
import { LolbasIngestor } from "./sources/lolbas";
import { GtfobinsIngestor } from "./sources/gtfobins";
import { LoldriversIngestor } from "./sources/loldrivers";
import { LolapiIngestor } from "./sources/lolapi";
import { LottunnelsIngestor } from "./sources/loltunnels";
import { LolrmmIngestor } from "./sources/lolrmm";
import { LoobinsIngestor } from "./sources/loobins";
import { PersistenceInfoIngestor } from "./sources/persistence-info";
import { LoasIngestor } from "./sources/loas";
import { SysinternalsIngestor } from "./sources/sysinternals";

export interface LibraryMeta {
  sourceId: string;
  displayName: string;
  description: string;
  repo: string;
  repoUrl: string;
  platform: string;
}

class IngestorRegistry {
  private ingestors = new Map<string, LotlIngestor>();

  register(ingestor: LotlIngestor): void {
    this.ingestors.set(ingestor.sourceId, ingestor);
  }
  get(sourceId: string): LotlIngestor | undefined {
    return this.ingestors.get(sourceId);
  }
  getAll(): LotlIngestor[] {
    return Array.from(this.ingestors.values());
  }
  sourceIds(): string[] {
    return Array.from(this.ingestors.keys());
  }
  meta(): LibraryMeta[] {
    return this.getAll().map((i) => ({
      sourceId: i.sourceId,
      displayName: i.displayName,
      description: i.description,
      repo: i.repo,
      repoUrl: i.repoUrl,
      platform: i.platform,
    }));
  }
}

let _registry: IngestorRegistry | null = null;

export function getRegistry(): IngestorRegistry {
  if (!_registry) {
    _registry = new IngestorRegistry();
    _registry.register(new LolbasIngestor());
    _registry.register(new GtfobinsIngestor());
    _registry.register(new LoldriversIngestor());
    _registry.register(new LolapiIngestor());
    _registry.register(new LottunnelsIngestor());
    _registry.register(new LolrmmIngestor());
    _registry.register(new LoobinsIngestor());
    _registry.register(new PersistenceInfoIngestor());
    _registry.register(new LoasIngestor());
    _registry.register(new SysinternalsIngestor());
  }
  return _registry;
}
