import type {
  BookingLink,
  LocationSpec,
  LocationSuggestions,
  ProviderInfo,
  Quote,
  ResolvedAirport,
  SearchJob,
  SearchRequest,
} from '../../shared/types';

export interface AppConfig {
  version: string;
  demo: boolean;
  providers: ProviderInfo;
  defaultLiveBudget: number;
  maxLiveBudget: number;
  ignavRequestsUsed: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return body as T;
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  config: () => request<AppConfig>('/config'),
  suggest: (q: string, signal?: AbortSignal) =>
    request<LocationSuggestions>(`/locations?${new URLSearchParams({ q })}`, { signal }),
  resolve: (specs: LocationSpec[]) => post<ResolvedAirport[]>('/locations/resolve', { specs }),
  startSearch: (req: SearchRequest) => post<SearchJob>('/search', req),
  getSearch: (id: string) => request<SearchJob>(`/search/${id}`),
  quotesForDates: (id: string, dep: string, ret: string) =>
    request<Quote[]>(`/search/${id}/dates?${new URLSearchParams({ dep, ret })}`),
  checkLive: (id: string, q: Pick<Quote, 'origin' | 'destination' | 'departDate' | 'returnDate'>) =>
    post<Quote | null>(`/search/${id}/check`, {
      origin: q.origin,
      destination: q.destination,
      dep: q.departDate,
      ret: q.returnDate,
    }),
  bookingLinks: (itineraryId: string) => post<BookingLink[]>('/booking-links', { itineraryId }),
};
