import type { PlaceSuggestion } from '../shared/types';
import { TtlCache } from './cache';

// OpenStreetMap Nominatim: free, but max 1 request per second and a descriptive User-Agent.
// https://operations.osmfoundation.org/policies/nominatim/
const NOMINATIM_URL = process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'flightscanner-selfhosted/0.1 (personal flight price comparison)';

const cache = new TtlCache<PlaceSuggestion[]>(30 * 86_400_000);
let queue: Promise<unknown> = Promise.resolve();

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => new Promise((r) => setTimeout(r, 1100)),
    () => new Promise((r) => setTimeout(r, 1100)),
  );
  return run;
}

export async function geocode(query: string): Promise<PlaceSuggestion[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];
  return cache.getOrLoad(q, () =>
    throttled(async () => {
      const url = `${NOMINATIM_URL}?${new URLSearchParams({ q, format: 'jsonv2', limit: '5', 'accept-language': 'en' })}`;
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Geocoding failed: HTTP ${res.status}`);
      const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
      const unique = rows.filter((r, i) => rows.findIndex((o) => o.display_name === r.display_name) === i);
      return unique.map((r) => ({ label: r.display_name, lat: Number(r.lat), lon: Number(r.lon) }));
    }),
  );
}
