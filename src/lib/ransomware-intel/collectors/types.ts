/**
 * Pluggable collector contract for the self-hosted ransomware-intel engine.
 * Each collector gathers gangs + victims from a source and returns normalized
 * rows; the registry upserts them. Collectors must NEVER throw — a failed source
 * returns its error in the result so collection degrades gracefully.
 */

export interface NormalizedGang {
  name: string;
  aliases?: string[];
  status?: string;                 // active|inactive|rebranded|unknown
  leakSiteUrls?: string[];
  screenshotRef?: string;          // URL or store ref
  description?: string;
  profile?: Record<string, unknown>;
  targetSectors?: string[];
  targetRegions?: string[];
  references?: Array<{ title: string; url: string }>;
}

export interface NormalizedVictim {
  gangName: string;
  victim: string;
  sector?: string;
  country?: string;
  postUrl?: string;
  screenshotRef?: string;
  discoveredAt?: string;           // ISO
}

export interface CollectResult {
  groups: NormalizedGang[];
  victims: NormalizedVictim[];
  errors: string[];
}

export interface Collector {
  id: string;                      // ransomwatch|ransomware-live|tor-leaksite
  meta(): { id: string; name: string; active: boolean; note?: string };
  collect(): Promise<CollectResult>;
}
