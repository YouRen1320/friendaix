import type { Site } from './preset.js';
import { SITES } from './preset.js';

export interface SiteSpeed {
  site: Site;
  latencyMs: number | null;
  ok: boolean;
  error?: string;
}

export async function pingSite(
  site: Site,
  timeoutMs = 5000,
): Promise<SiteSpeed> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(site.healthCheck, {
      signal: controller.signal,
      headers: { 'cache-control': 'no-cache' },
    });
    const latencyMs = Date.now() - startedAt;
    return response.ok
      ? { site, latencyMs, ok: true }
      : {
          site,
          latencyMs,
          ok: false,
          error: `HTTP ${response.status}`,
        };
  } catch (error: unknown) {
    return {
      site,
      latencyMs: null,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function pingAll(): Promise<SiteSpeed[]> {
  return Promise.all(SITES.map((site) => pingSite(site)));
}

export function chooseSite(
  results: SiteSpeed[],
  preferredSiteId?: string,
): SiteSpeed | null {
  const available = results.filter(
    (result) => result.ok && result.latencyMs !== null,
  );
  if (available.length === 0) return null;
  const preferred = available.find(
    (result) => result.site.id === preferredSiteId,
  );
  if (preferred) return preferred;
  return (
    [...available].sort(
      (left, right) => left.latencyMs! - right.latencyMs!,
    )[0] ?? null
  );
}
