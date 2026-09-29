import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IgnavProvider } from './ignav';
import { TravelpayoutsProvider } from './travelpayouts';
import { ProviderError, type LiveQuery } from './types';

// Retry and error handling of the real providers, with fetch stubbed so nothing leaves the machine.

const fetchMock = vi.fn<typeof fetch>();
const json = (status: number, body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ toFake: ['setTimeout'] });
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Runs a provider call to completion, fast-forwarding through retry back-off. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  const result = await settled;
  if ('error' in result) throw result.error;
  return result.value;
}

describe('IgnavProvider', () => {
  const query: LiveQuery = {
    origin: 'AMS',
    destination: 'BOG',
    dep: '2026-12-10',
    ret: '2026-12-22',
    filters: { adults: 2, maxStops: 1, minCheckedBags: 0, allowSelfTransfer: false },
  };
  const itinerary = {
    ignav_id: 'it-1',
    price: { amount: 1400, currency: 'EUR', status: 'verified' },
    outbound: { carrier: 'KLM', duration_minutes: 660, segments: [] },
  };

  it('sends the filters, counts the billed request and caches the answer', async () => {
    fetchMock.mockImplementation(json(200, { itineraries: [itinerary] }));
    const billed = vi.fn();
    const ignav = new IgnavProvider('secret', 'NL', billed);

    expect((await settle(ignav.roundTrip(query)))?.price).toBe(1400);
    expect((await settle(ignav.roundTrip(query)))?.price).toBe(1400);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(billed).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ignav.com/api/fares/round-trip');
    expect(init?.headers).toMatchObject({ 'X-Api-Key': 'secret' });
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ adults: 2, max_stops: 1, market: 'NL' });
    expect(body).not.toHaveProperty('min_checked_bags');
  });

  it('retries upstream hiccups (424) and then succeeds', async () => {
    fetchMock
      .mockImplementationOnce(json(424, { error: { message: 'upstream' } }))
      .mockImplementationOnce(json(424, { error: { message: 'upstream' } }))
      .mockImplementation(json(200, { itineraries: [itinerary] }));
    const billed = vi.fn();

    expect(await settle(new IgnavProvider('k', 'NL', billed).roundTrip(query))).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(billed).toHaveBeenCalledTimes(1);
  });

  it('gives up after three attempts on repeated 503s', async () => {
    fetchMock.mockImplementation(json(503, {}));
    const error = await settle(new IgnavProvider('k', 'NL').roundTrip(query)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ message: 'Ignav: HTTP 503', status: 503, fatal: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([401, 402, 429])('treats HTTP %i as fatal without retrying', async (status) => {
    fetchMock.mockImplementation(json(status, { error: { message: 'billing required' } }));
    const billed = vi.fn();
    const error = await settle(new IgnavProvider('k', 'NL', billed).roundTrip(query)).catch((e: unknown) => e);
    expect(error).toMatchObject({ message: 'Ignav: billing required', status, fatal: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(billed).not.toHaveBeenCalled();
  });

  it('flattens booking links from all booking options', async () => {
    fetchMock.mockImplementation(
      json(200, {
        booking_options: [
          {
            links: [
              {
                provider_name: 'KLM',
                provider_type: 'airline',
                price: { amount: 1400, currency: 'EUR' },
                url: 'https://klm.example',
              },
            ],
          },
          { links: [{ provider_name: 'Kiwi', provider_type: 'third_party', url: 'https://kiwi.example' }] },
        ],
      }),
    );
    expect(await settle(new IgnavProvider('k', 'NL').bookingLinks('it-1'))).toEqual([
      { providerName: 'KLM', providerType: 'airline', price: 1400, currency: 'EUR', url: 'https://klm.example' },
      { providerName: 'Kiwi', providerType: 'third_party', price: null, currency: null, url: 'https://kiwi.example' },
    ]);
  });
});

describe('TravelpayoutsProvider', () => {
  const query = { origin: 'AMS', destination: 'BOG', depMonth: '2026-12', retMonth: '2026-12', directOnly: true };

  it('backs off on rate limits (429) and then succeeds', async () => {
    fetchMock
      .mockImplementationOnce(json(429, {}))
      .mockImplementation(
        json(200, { success: true, data: [{ price: 689, departure_at: '2026-12-10', return_at: '2026-12-20' }] }),
      );
    const prices = await settle(new TravelpayoutsProvider('token', 'nl').fetchMonth(query));
    expect(prices.map((p) => p.price)).toEqual([689]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('direct')).toBe('true');
    expect(url.searchParams.get('market')).toBe('nl');
  });

  it.each([401, 403])('treats HTTP %i as a fatal token problem', async (status) => {
    fetchMock.mockImplementation(json(status, {}));
    const error = await settle(new TravelpayoutsProvider('bad', null).fetchMonth(query)).catch((e: unknown) => e);
    expect(error).toMatchObject({ message: 'Travelpayouts: token rejected', status, fatal: true });
  });

  it('reports other HTTP errors as non-fatal', async () => {
    fetchMock.mockImplementation(json(500, {}));
    const error = await settle(new TravelpayoutsProvider('t', null).fetchMonth(query)).catch((e: unknown) => e);
    expect(error).toMatchObject({ message: 'Travelpayouts: HTTP 500', status: 500, fatal: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
