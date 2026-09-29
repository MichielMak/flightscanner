import type { Airport, LocationSpec, ResolvedAirport } from '../shared/types';
import airportData from './data/airports.json' with { type: 'json' };

const AIRPORTS = airportData as Airport[];

export function allAirports(): Airport[] {
  return AIRPORTS;
}

export function airportByCode(code: string): Airport | undefined {
  return allAirports().find((a) => a.code === code.toUpperCase());
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function searchAirports(query: string, limit = 8): Airport[] {
  const q = normalize(query.trim());
  if (q.length < 2) return [];
  const scored: { a: Airport; score: number }[] = [];
  for (const a of allAirports()) {
    let score = 0;
    if (a.code.toLowerCase() === q) score = 100;
    else if (normalize(a.city).startsWith(q)) score = 60;
    else if (normalize(a.name).startsWith(q)) score = 50;
    else if (normalize(a.city).includes(q) || normalize(a.name).includes(q)) score = 30;
    if (score === 0) continue;
    if (a.size === 'large') score += 5;
    scored.push({ a, score });
  }
  return scored
    .sort((x, y) => y.score - x.score || x.a.code.localeCompare(y.a.code))
    .slice(0, limit)
    .map((s) => s.a);
}

export function searchCountries(query: string, limit = 3) {
  const q = normalize(query.trim());
  if (q.length < 2) return [];
  const counts = new Map<string, { code: string; name: string; airportCount: number }>();
  for (const a of allAirports()) {
    const entry = counts.get(a.country) ?? { code: a.country, name: a.countryName, airportCount: 0 };
    entry.airportCount++;
    counts.set(a.country, entry);
  }
  return [...counts.values()]
    .filter((c) => normalize(c.name).startsWith(q) || c.code.toLowerCase() === q)
    .sort((a, b) => b.airportCount - a.airportCount)
    .slice(0, limit);
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Turns what the user typed (airports, countries, "near X") into one de-duplicated airport list. */
export function resolveLocations(specs: LocationSpec[]): ResolvedAirport[] {
  const out = new Map<string, ResolvedAirport>();
  const add = (a: Airport, suggested: boolean, distance?: number) => {
    const existing = out.get(a.code);
    if (existing) {
      existing.suggested ||= suggested;
      if (distance !== undefined) existing.distanceKm = Math.min(existing.distanceKm ?? Infinity, distance);
      return;
    }
    out.set(a.code, { ...a, suggested, ...(distance !== undefined && { distanceKm: distance }) });
  };

  for (const spec of specs) {
    if (spec.kind === 'airport') {
      const a = airportByCode(spec.code);
      if (a) add(a, true);
    } else if (spec.kind === 'country') {
      for (const a of allAirports()) if (a.country === spec.code) add(a, a.size === 'large');
    } else {
      for (const a of allAirports()) {
        const d = distanceKm(spec.lat, spec.lon, a.lat, a.lon);
        if (d <= spec.radiusKm) add(a, a.size === 'large', Math.round(d));
      }
    }
  }

  return [...out.values()].sort(
    (a, b) =>
      Number(b.suggested) - Number(a.suggested) ||
      (a.distanceKm ?? 0) - (b.distanceKm ?? 0) ||
      a.code.localeCompare(b.code),
  );
}
