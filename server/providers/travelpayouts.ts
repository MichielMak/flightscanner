import { TtlCache } from '../cache';
import { ProviderError, type CachedMonthQuery, type CachedPrice, type CachedPriceProvider } from './types';

// Aviasales Data API via Travelpayouts: free, returns prices other users found in the last ~7 days.
// https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API
const PRICES_FOR_DATES = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';

interface TravelpayoutsTicket {
  origin_airport?: string;
  destination_airport?: string;
  price: number;
  airline?: string;
  departure_at?: string;
  return_at?: string;
  transfers?: number;
  return_transfers?: number;
}

interface TravelpayoutsResponse {
  success: boolean;
  data?: TravelpayoutsTicket[];
  currency?: string;
  error?: string;
}

export function parseTravelpayouts(query: CachedMonthQuery, body: TravelpayoutsResponse): CachedPrice[] {
  if (!body.success) throw new ProviderError(`Travelpayouts: ${body.error ?? 'request failed'}`);
  const currency = (body.currency ?? 'eur').toUpperCase();
  const out: CachedPrice[] = [];
  for (const t of body.data ?? []) {
    if (!t.departure_at || !t.return_at || !(t.price > 0)) continue;
    // A city code query can return other airports in that city; keep only the airport asked for.
    if (t.origin_airport && t.origin_airport !== query.origin) continue;
    if (t.destination_airport && t.destination_airport !== query.destination) continue;
    out.push({
      origin: query.origin,
      destination: query.destination,
      // "2026-12-10T10:35:00+01:00": the first 10 chars are the local departure date
      dep: t.departure_at.slice(0, 10),
      ret: t.return_at.slice(0, 10),
      price: t.price,
      currency,
      airline: t.airline ?? null,
      stopsOut: t.transfers ?? null,
      stopsBack: t.return_transfers ?? null,
    });
  }
  return out;
}

export class TravelpayoutsProvider implements CachedPriceProvider {
  readonly name = 'travelpayouts' as const;
  private cache = new TtlCache<CachedPrice[]>(6 * 3_600_000);

  constructor(
    private token: string,
    private market: string | null,
  ) {}

  fetchMonth(query: CachedMonthQuery): Promise<CachedPrice[]> {
    const params = new URLSearchParams({
      origin: query.origin,
      destination: query.destination,
      departure_at: query.depMonth,
      return_at: query.retMonth,
      one_way: 'false',
      direct: String(query.directOnly),
      unique: 'false',
      sorting: 'price',
      currency: 'eur',
      limit: '1000',
      page: '1',
      ...(this.market && { market: this.market }),
    });
    return this.cache.getOrLoad(params.toString(), async () => {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${PRICES_FOR_DATES}?${params}`, {
          headers: { 'X-Access-Token': this.token, 'Accept-Encoding': 'gzip, deflate' },
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 429 && attempt < 3) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          throw new ProviderError('Travelpayouts: token rejected', res.status, true);
        }
        if (!res.ok) throw new ProviderError(`Travelpayouts: HTTP ${res.status}`, res.status);
        return parseTravelpayouts(query, (await res.json()) as TravelpayoutsResponse);
      }
    });
  }
}
