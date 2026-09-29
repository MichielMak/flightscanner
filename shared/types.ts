// Types shared between the server and the web app.

export interface Airport {
  code: string;
  name: string;
  city: string;
  country: string;
  countryName: string;
  lat: number;
  lon: number;
  size: 'large' | 'medium';
}

/** What the user typed into a "From" / "To" field, before it becomes a list of airports. */
export type LocationSpec =
  | { kind: 'airport'; code: string; label: string }
  | { kind: 'country'; code: string; label: string }
  | { kind: 'near'; lat: number; lon: number; radiusKm: number; label: string };

export interface ResolvedAirport extends Airport {
  /** Distance from the "near" point, when the airport came from a radius search. */
  distanceKm?: number;
  /** Pre-selected in the UI. Large airports are on by default, smaller ones off. */
  suggested: boolean;
}

export interface PlaceSuggestion {
  label: string;
  lat: number;
  lon: number;
}

export interface LocationSuggestions {
  airports: Airport[];
  countries: { code: string; name: string; airportCount: number }[];
  places: PlaceSuggestion[];
}

export type DateOptions =
  | {
      mode: 'exact';
      departDate: string;
      returnDate: string;
      /** Also try this many days before/after both dates. */
      flexDays: number;
    }
  | {
      mode: 'flexible';
      /** Departure must fall between windowStart and windowEnd (inclusive). */
      windowStart: string;
      windowEnd: string;
      tripDays: number;
      /** Accept trips of tripDays ± marginDays. */
      marginDays: number;
      /** Also require the return date to be inside the window. */
      returnWithinWindow: boolean;
    };

export interface SearchFilters {
  adults: number;
  /** null = any number of stops */
  maxStops: number | null;
  minCheckedBags: number;
  allowSelfTransfer: boolean;
}

export interface SearchRequest {
  origins: string[];
  destinations: string[];
  dates: DateOptions;
  filters: SearchFilters;
  /** Max number of live (paid) price checks this search may use. */
  liveBudget: number;
}

export interface LegSummary {
  carrier: string | null;
  durationMinutes: number | null;
  stops: number;
  via: string[];
  flights: string[];
  departLocal: string;
  arriveLocal: string;
}

export interface ItinerarySummary {
  ignavId: string;
  outbound: LegSummary;
  inbound: LegSummary | null;
  priceStatus: 'verified' | 'unverified';
  selfTransfer: boolean | null;
  checkedBags: number | null;
}

export type QuoteSource = 'cached' | 'live';

export interface Quote {
  origin: string;
  destination: string;
  departDate: string;
  returnDate: string;
  days: number;
  price: number;
  currency: string;
  source: QuoteSource;
  /** Present for live quotes. */
  itinerary?: ItinerarySummary;
  /** Cached quotes: extra info from the cache. */
  cachedInfo?: { airline: string | null; stopsOut: number | null; stopsBack: number | null };
  /** Live check ran but found no flights (price is then the cached one, if any). */
  liveNoResult?: boolean;
}

export interface ProviderInfo {
  cached: 'travelpayouts' | 'demo' | 'none';
  live: 'ignav' | 'demo' | 'none';
}

export interface SearchResults {
  /** Cheapest options overall. */
  top: Quote[];
  /** Cheapest option per origin-destination route. */
  byRoute: Quote[];
  /** Cheapest option per (departure, return) date pair, across all routes. */
  byDates: Quote[];
  /** Number of priced options found in total. */
  total: number;
}

export interface SearchJob {
  id: string;
  status: 'running' | 'done' | 'error';
  phase: string;
  progress: { done: number; total: number };
  request: SearchRequest;
  results: SearchResults;
  warnings: string[];
  liveRequestsUsed: number;
  cachedRequestsUsed: number;
  providers: ProviderInfo;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface BookingLink {
  providerName: string;
  providerType: 'airline' | 'third_party';
  price: number | null;
  currency: string | null;
  url: string;
}
