import type { BookingLink, LegSummary } from '../../shared/types';
import { airportByCode, distanceKm } from '../airports';
import { addDays, daysBetween, toDays } from '../../shared/dates';
import type {
  CachedMonthQuery,
  CachedPrice,
  CachedPriceProvider,
  LivePriceProvider,
  LiveQuery,
  LiveResult,
} from './types';

// Fake but deterministic prices so the app works without API keys. Clearly labelled as demo data in the UI.

/** FNV-1a hash mapped to [0, 1). Same input always gives the same "price noise". */
function noise(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 2 ** 32;
}

const HUBS: Record<string, number> = { AMS: 0.92, BRU: 0.97, DUS: 1.0, FRA: 0.95, CDG: 0.93, MAD: 0.85 };
const CARRIERS = ['KLM', 'Air France', 'Iberia', 'Avianca', 'Lufthansa', 'Air Europa', 'TAP Air Portugal'];
const CONNECTIONS = ['MAD', 'CDG', 'AMS', 'LIS', 'FRA', 'BOG'];

function basePrice(origin: string, destination: string): number {
  const a = airportByCode(origin);
  const b = airportByCode(destination);
  const km = a && b ? distanceKm(a.lat, a.lon, b.lat, b.lon) : 5000;
  return (120 + km * 0.07) * (HUBS[origin] ?? HUBS[destination] ?? 1.12);
}

export function demoPrice(origin: string, destination: string, dep: string, ret: string): number {
  let price = basePrice(origin, destination);
  const depDay = new Date(toDays(dep) * 86_400_000);
  const month = depDay.getUTCMonth();
  const date = depDay.getUTCDate();
  if (month === 11 && date >= 17 && date <= 24) price *= 1.35; // Christmas rush
  if (month === 6 || month === 7) price *= 1.2; // summer
  if ([5, 6, 0].includes(depDay.getUTCDay())) price *= 1.08; // Fri-Sun departures
  const days = daysBetween(dep, ret);
  if (days < 7) price *= 1.1;
  price *= 0.85 + noise(`${origin}${destination}${dep}${ret}`) * 0.3;
  return Math.round(price);
}

export class DemoCachedProvider implements CachedPriceProvider {
  readonly name = 'demo' as const;

  async fetchMonth(q: CachedMonthQuery): Promise<CachedPrice[]> {
    await new Promise((r) => setTimeout(r, 40));
    const out: CachedPrice[] = [];
    const first = `${q.depMonth}-01`;
    for (let i = 0; i < 31; i++) {
      const dep = addDays(first, i);
      if (!dep.startsWith(q.depMonth)) break;
      for (let len = 1; len <= 40; len++) {
        const ret = addDays(dep, len);
        if (!ret.startsWith(q.retMonth)) continue;
        // Real caches are patchy: only ~55% of date pairs have a price.
        if (noise(`cov${q.origin}${q.destination}${dep}${ret}`) > 0.55) continue;
        const stops = noise(`stops${q.origin}${q.destination}`) < 0.3 ? 0 : 1;
        if (q.directOnly && stops > 0) continue;
        out.push({
          origin: q.origin,
          destination: q.destination,
          dep,
          ret,
          price: demoPrice(q.origin, q.destination, dep, ret),
          currency: 'EUR',
          airline: null,
          stopsOut: stops,
          stopsBack: stops,
        });
      }
    }
    return out;
  }
}

function demoLeg(from: string, to: string, date: string, seed: string, maxStops: number | null): LegSummary {
  const direct = noise(`direct${seed}`) < 0.3 || maxStops === 0;
  const via = direct
    ? []
    : [CONNECTIONS[Math.floor(noise(`via${seed}`) * CONNECTIONS.length)]].filter((c) => c !== from && c !== to);
  const hour = 7 + Math.floor(noise(`h${seed}`) * 12);
  const duration = 11 * 60 + via.length * 150 + Math.floor(noise(`d${seed}`) * 90);
  const carrier = CARRIERS[Math.floor(noise(`c${seed}`) * CARRIERS.length)];
  const depart = `${date}T${String(hour).padStart(2, '0')}:${noise(`m${seed}`) < 0.5 ? '15' : '45'}:00`;
  const arriveMs = Date.parse(`${depart}Z`) + duration * 60_000 - 6 * 3_600_000;
  return {
    carrier,
    durationMinutes: duration,
    stops: via.length,
    via,
    flights: [`XX${100 + Math.floor(noise(`f${seed}`) * 800)}`],
    departLocal: depart,
    arriveLocal: new Date(arriveMs).toISOString().slice(0, 19),
  };
}

export class DemoLiveProvider implements LivePriceProvider {
  readonly name = 'demo' as const;

  async roundTrip(q: LiveQuery): Promise<LiveResult | null> {
    await new Promise((r) => setTimeout(r, 120 + noise(q.dep + q.ret) * 250));
    const seed = `${q.origin}${q.destination}${q.dep}${q.ret}`;
    if (noise(`none${seed}`) < 0.05) return null;
    const price = Math.round(demoPrice(q.origin, q.destination, q.dep, q.ret) * (0.95 + noise(`live${seed}`) * 0.15));
    return {
      price: price * q.filters.adults + q.filters.minCheckedBags * 60,
      currency: 'EUR',
      itinerary: {
        ignavId: `demo-${seed}`,
        outbound: demoLeg(q.origin, q.destination, q.dep, `out${seed}`, q.filters.maxStops),
        inbound: demoLeg(q.destination, q.origin, q.ret, `in${seed}`, q.filters.maxStops),
        priceStatus: 'verified',
        selfTransfer: false,
        checkedBags: Math.max(q.filters.minCheckedBags, 1),
      },
    };
  }

  async bookingLinks(): Promise<BookingLink[]> {
    return [];
  }
}
