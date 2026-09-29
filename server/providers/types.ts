import type { BookingLink, ItinerarySummary, SearchFilters } from '../../shared/types';

/** A price from a cache of other people's searches. Cheap to fetch, possibly stale. */
export interface CachedPrice {
  origin: string;
  destination: string;
  dep: string;
  ret: string;
  price: number;
  currency: string;
  airline: string | null;
  stopsOut: number | null;
  stopsBack: number | null;
}

export interface CachedMonthQuery {
  origin: string;
  destination: string;
  /** YYYY-MM */
  depMonth: string;
  /** YYYY-MM */
  retMonth: string;
  directOnly: boolean;
}

export interface CachedPriceProvider {
  name: 'travelpayouts' | 'demo';
  /** All cached round-trip prices for a route with departure/return in the given months. */
  fetchMonth(query: CachedMonthQuery): Promise<CachedPrice[]>;
}

export interface LiveQuery {
  origin: string;
  destination: string;
  dep: string;
  ret: string;
  filters: SearchFilters;
}

export interface LiveResult {
  price: number;
  currency: string;
  itinerary: ItinerarySummary;
}

export interface LivePriceProvider {
  name: 'ignav' | 'demo';
  /** Cheapest bookable round trip, or null when no flights match. */
  roundTrip(query: LiveQuery): Promise<LiveResult | null>;
  bookingLinks(itineraryId: string): Promise<BookingLink[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** When true, stop the whole search: retrying other routes will fail the same way (billing, bad key). */
    readonly fatal = false,
  ) {
    super(message);
  }
}
