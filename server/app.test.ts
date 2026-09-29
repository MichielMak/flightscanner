import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SearchJob, SearchRequest } from '../shared/types';
import { createApp } from './app';
import { DemoCachedProvider, DemoLiveProvider } from './providers/demo';
import { ProviderError, type LivePriceProvider } from './providers/types';
import { SearchEngine } from './search';
import { UsageCounter } from './usage';

const request: SearchRequest = {
  origins: ['AMS'],
  destinations: ['BOG'],
  dates: { mode: 'exact', departDate: '2027-02-03', returnDate: '2027-02-15', flexDays: 0 },
  filters: { adults: 1, maxStops: null, minCheckedBags: 0, allowSelfTransfer: false },
  liveBudget: 1,
};

function setup(live: LivePriceProvider | null = new DemoLiveProvider()) {
  const usage = new UsageCounter(mkdtempSync(join(tmpdir(), 'flightscanner-app-')));
  return createApp(new SearchEngine(new DemoCachedProvider(), live), usage);
}

const post = (app: ReturnType<typeof setup>, path: string, body: unknown) =>
  app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

const failingLive = (error: Error): LivePriceProvider => ({
  name: 'ignav',
  roundTrip: async () => null,
  bookingLinks: async () => {
    throw error;
  },
});

afterEach(() => vi.restoreAllMocks());

describe('GET /api/config', () => {
  it('reports providers, budgets and billed usage', async () => {
    const res = await setup().request('/api/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      providers: { cached: 'demo', live: 'demo' },
      defaultLiveBudget: 25,
      maxLiveBudget: 150,
      ignavRequestsUsed: 0,
    });
  });
});

describe('POST /api/search', () => {
  it('starts a job and upper-cases airport codes', async () => {
    const res = await post(setup(), '/api/search', { ...request, origins: ['ams'] });
    expect(res.status).toBe(202);
    const job = (await res.json()) as SearchJob;
    expect(job.status).toBe('running');
    expect(job.request.origins).toEqual(['AMS']);
  });

  it('rejects a return date before the departure date', async () => {
    const res = await post(setup(), '/api/search', {
      ...request,
      dates: { ...request.dates, returnDate: '2027-02-01' },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(
      'Return date must be on or after the departure date',
    );
  });

  it('rejects a live budget above the configured maximum', async () => {
    const res = await post(setup(), '/api/search', { ...request, liveBudget: 151 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/^liveBudget: /);
  });

  it('rejects a flexible period longer than 3 months', async () => {
    const res = await post(setup(), '/api/search', {
      ...request,
      dates: {
        mode: 'flexible',
        windowStart: '2027-01-01',
        windowEnd: '2027-05-01',
        tripDays: 10,
        marginDays: 0,
        returnWithinWindow: false,
      },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('Period can be at most 3 months');
  });

  it('rejects malformed airport codes', async () => {
    const res = await post(setup(), '/api/search', { ...request, destinations: ['BOGOTA'] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/^destinations\.0: /);
  });
});

describe('search job routes', () => {
  it('returns 404 for an unknown or expired job', async () => {
    const app = setup();
    expect((await app.request('/api/search/nope')).status).toBe(404);
    expect((await app.request('/api/search/nope/dates?dep=2027-02-03&ret=2027-02-15')).status).toBe(404);
    const check = await post(app, '/api/search/nope/check', {
      origin: 'AMS',
      destination: 'BOG',
      dep: '2027-02-03',
      ret: '2027-02-15',
    });
    expect(check.status).toBe(404);
    expect(await check.json()).toEqual({ error: 'Search not found' });
  });

  it('validates the date query of the per-dates view', async () => {
    const res = await setup().request('/api/search/any/dates?dep=03-02-2027&ret=2027-02-15');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('Use YYYY-MM-DD');
  });

  it('live-checks a single option of an existing job', async () => {
    const app = setup();
    const job = (await (await post(app, '/api/search', request)).json()) as SearchJob;
    const res = await post(app, `/api/search/${job.id}/check`, {
      origin: 'AMS',
      destination: 'BOG',
      dep: '2027-03-01',
      ret: '2027-03-10',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ origin: 'AMS', destination: 'BOG', source: 'live' });
  });

  it('refuses a live check without a live provider', async () => {
    const app = setup(null);
    const job = (await (await post(app, '/api/search', request)).json()) as SearchJob;
    const res = await post(app, `/api/search/${job.id}/check`, {
      origin: 'AMS',
      destination: 'BOG',
      dep: '2027-02-03',
      ret: '2027-02-15',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/booking-links', () => {
  it('returns 400 without a live provider', async () => {
    const res = await post(setup(null), '/api/booking-links', { itineraryId: 'x' });
    expect(res.status).toBe(400);
  });

  it('passes provider HTTP errors through', async () => {
    const res = await post(setup(failingLive(new ProviderError('Ignav: bad key', 401, true))), '/api/booking-links', {
      itineraryId: 'x',
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Ignav: bad key' });
  });

  it('maps provider errors without a usable status to 502', async () => {
    const res = await post(setup(failingLive(new ProviderError('Ignav: timeout'))), '/api/booking-links', {
      itineraryId: 'x',
    });
    expect(res.status).toBe(502);
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const res = await post(setup(failingLive(new Error('secret stack detail'))), '/api/booking-links', {
      itineraryId: 'x',
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal error' });
  });
});

describe('location routes', () => {
  it('suggests airports for an exact code without calling the geocoder', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await setup().request('/api/locations?q=AMS');
    const body = (await res.json()) as { airports: { code: string }[]; places: unknown[] };
    expect(body.airports[0].code).toBe('AMS');
    expect(body.places).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves an airport spec', async () => {
    const res = await post(setup(), '/api/locations/resolve', {
      specs: [{ kind: 'airport', code: 'bog', label: 'Bogotá' }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { code: string }[]).map((a) => a.code)).toEqual(['BOG']);
  });

  it('rejects a radius search outside the allowed range', async () => {
    const res = await post(setup(), '/api/locations/resolve', {
      specs: [{ kind: 'near', lat: 51.56, lon: 5.09, radiusKm: 5000, label: 'Tilburg' }],
    });
    expect(res.status).toBe(400);
  });
});
