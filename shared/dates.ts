import type { DateOptions } from './types';

export interface DatePair {
  dep: string;
  ret: string;
  days: number;
}

const DAY_MS = 86_400_000;

export function toDays(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function fromDays(days: number): string {
  return new Date(days * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return fromDays(toDays(iso) + n);
}

export function daysBetween(from: string, to: string): number {
  return toDays(to) - toDays(from);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** All (departure, return) combinations the user is willing to fly, skipping dates before `earliest`. */
export function generatePairs(dates: DateOptions, earliest: string = todayIso()): DatePair[] {
  const min = toDays(earliest);
  const pairs: DatePair[] = [];

  if (dates.mode === 'exact') {
    const dep0 = toDays(dates.departDate);
    const ret0 = toDays(dates.returnDate);
    for (let dd = -dates.flexDays; dd <= dates.flexDays; dd++) {
      for (let rd = -dates.flexDays; rd <= dates.flexDays; rd++) {
        const dep = dep0 + dd;
        const ret = ret0 + rd;
        if (dep < min || ret < dep) continue;
        pairs.push({ dep: fromDays(dep), ret: fromDays(ret), days: ret - dep });
      }
    }
    return pairs;
  }

  const start = Math.max(toDays(dates.windowStart), min);
  const end = toDays(dates.windowEnd);
  const shortest = Math.max(1, dates.tripDays - dates.marginDays);
  const longest = dates.tripDays + dates.marginDays;
  for (let dep = start; dep <= end; dep++) {
    for (let len = shortest; len <= longest; len++) {
      const ret = dep + len;
      if (dates.returnWithinWindow && ret > end) continue;
      pairs.push({ dep: fromDays(dep), ret: fromDays(ret), days: len });
    }
  }
  return pairs;
}

/** Distinct YYYY-MM months that the given dates fall in, sorted. */
export function monthsOf(dates: string[]): string[] {
  return [...new Set(dates.map((d) => d.slice(0, 7)))].sort();
}

export function pairKey(origin: string, destination: string, dep: string, ret: string): string {
  return `${origin}-${destination}-${dep}-${ret}`;
}
