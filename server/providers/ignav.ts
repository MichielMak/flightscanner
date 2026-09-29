import type { BookingLink, LegSummary } from '../../shared/types';
import { TtlCache } from '../cache';
import { ProviderError, type LivePriceProvider, type LiveQuery, type LiveResult } from './types';

// Live, bookable prices. Docs: https://ignav.com/docs  (billed per successful request)
const BASE_URL = 'https://ignav.com/api';

interface IgnavSegment {
  marketing_carrier_code: string | null;
  flight_number: string | null;
  operating_carrier_name: string | null;
  departure_airport: string;
  departure_time_local: string;
  arrival_airport: string;
  arrival_time_local: string;
}

interface IgnavLeg {
  carrier: string | null;
  duration_minutes: number | null;
  segments: IgnavSegment[];
}

interface IgnavItinerary {
  price: { amount: number; currency: string; status: 'verified' | 'unverified' };
  outbound: IgnavLeg;
  inbound?: IgnavLeg | null;
  bags?: { carry_on: number | null; checked: number | null } | null;
  requires_self_transfer?: boolean | null;
  ignav_id: string;
}

interface IgnavBookingResponse {
  booking_options: {
    links: {
      provider_name: string;
      provider_type: 'airline' | 'third_party';
      price?: { amount: number; currency: string } | null;
      url: string;
    }[];
  }[];
}

export function summarizeLeg(leg: IgnavLeg): LegSummary {
  const segs = leg.segments;
  return {
    carrier: leg.carrier ?? segs[0]?.operating_carrier_name ?? null,
    durationMinutes: leg.duration_minutes,
    stops: Math.max(0, segs.length - 1),
    via: segs.slice(0, -1).map((s) => s.arrival_airport),
    flights: segs.map((s) => `${s.marketing_carrier_code ?? ''}${s.flight_number ?? ''}`).filter(Boolean),
    departLocal: segs[0]?.departure_time_local ?? '',
    arriveLocal: segs.at(-1)?.arrival_time_local ?? '',
  };
}

/** Picks the cheapest real fare from an Ignav response. Amount 0 means "placeholder", not free. */
export function cheapestItinerary(itineraries: IgnavItinerary[]): LiveResult | null {
  const best = itineraries.filter((i) => i.price.amount > 0).sort((a, b) => a.price.amount - b.price.amount)[0];
  if (!best) return null;
  return {
    price: best.price.amount,
    currency: best.price.currency,
    itinerary: {
      ignavId: best.ignav_id,
      outbound: summarizeLeg(best.outbound),
      inbound: best.inbound ? summarizeLeg(best.inbound) : null,
      priceStatus: best.price.status,
      selfTransfer: best.requires_self_transfer ?? null,
      checkedBags: best.bags?.checked ?? null,
    },
  };
}

export class IgnavProvider implements LivePriceProvider {
  readonly name = 'ignav' as const;
  private cache = new TtlCache<LiveResult | null>(2 * 3_600_000);

  constructor(
    private apiKey: string,
    private market: string,
    private onBilledRequest: () => void = () => {},
  ) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) {
        this.onBilledRequest();
        return (await res.json()) as T;
      }
      const err = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      const message = `Ignav: ${err?.error?.message ?? `HTTP ${res.status}`}`;
      // 424 = upstream hiccup (safe to retry), 503 = billing period rollover (retry shortly)
      if ((res.status === 424 || res.status === 503) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      // 401 bad key, 402 billing required, 429 monthly spend limit: every other call will fail too.
      throw new ProviderError(message, res.status, [401, 402, 429].includes(res.status));
    }
  }

  async roundTrip(q: LiveQuery): Promise<LiveResult | null> {
    const body = {
      origin: q.origin,
      destination: q.destination,
      departure_date: q.dep,
      return_date: q.ret,
      adults: q.filters.adults,
      allow_self_transfer: q.filters.allowSelfTransfer,
      market: this.market,
      ...(q.filters.maxStops !== null && { max_stops: q.filters.maxStops }),
      ...(q.filters.minCheckedBags > 0 && { min_checked_bags: q.filters.minCheckedBags }),
    };
    return this.cache.getOrLoad(JSON.stringify(body), async () => {
      const data = await this.post<{ itineraries: IgnavItinerary[] }>('/fares/round-trip', body);
      return cheapestItinerary(data.itineraries ?? []);
    });
  }

  async bookingLinks(itineraryId: string): Promise<BookingLink[]> {
    const data = await this.post<IgnavBookingResponse>('/fares/booking-links', { ignav_id: itineraryId });
    return data.booking_options.flatMap((o) =>
      o.links.map((l) => ({
        providerName: l.provider_name,
        providerType: l.provider_type,
        price: l.price?.amount ?? null,
        currency: l.price?.currency ?? null,
        url: l.url,
      })),
    );
  }
}
