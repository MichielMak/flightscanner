import { describe, expect, it } from 'vitest';
import type { Quote, SearchRequest } from '../shared/types';
import { generatePairs, pairKey } from '../shared/dates';
import { DemoCachedProvider, DemoLiveProvider } from './providers/demo';
import type { CachedPriceProvider, LivePriceProvider } from './providers/types';
import { ProviderError } from './providers/types';
import { SearchEngine, selectForLive, spreadPairs, summarize } from './search';

const pairs = generatePairs(
  {
    mode: 'flexible',
    windowStart: '2026-12-01',
    windowEnd: '2026-12-31',
    tripDays: 12,
    marginDays: 2,
    returnWithinWindow: false,
  },
  '2026-10-01',
);

const quote = (
  origin: string,
  destination: string,
  dep: string,
  ret: string,
  price: number,
  source: Quote['source'] = 'cached',
): Quote => ({
  origin,
  destination,
  departDate: dep,
  returnDate: ret,
  days: 0,
  price,
  currency: 'EUR',
  source,
});

describe('spreadPairs', () => {
  it('picks trips of the wanted length spread over the period', () => {
    const picked = spreadPairs(pairs, 12, 3);
    expect(picked.map((p) => p.days)).toEqual([12, 12, 12]);
    expect(picked.map((p) => p.dep)).toEqual(['2026-12-01', '2026-12-16', '2026-12-31']);
  });
});

describe('selectForLive', () => {
  const routes: [string, string][] = [
    ['AMS', 'BOG'],
    ['BRU', 'BOG'],
    ['DUS', 'BOG'],
  ];

  it('checks everything when it fits the budget', () => {
    const targets = selectForLive({ routes, pairs: pairs.slice(0, 2), cached: [], budget: 10, targetDays: 12 });
    expect(targets).toHaveLength(6);
  });

  it('never exceeds the budget', () => {
    const cached = pairs.flatMap((p, i) => routes.map(([o, d], j) => quote(o, d, p.dep, p.ret, 500 + i + j * 7)));
    expect(selectForLive({ routes, pairs, cached, budget: 10, targetDays: 12 })).toHaveLength(10);
  });

  it('gives every route its cheapest cached date, then the cheapest overall', () => {
    const cached = [
      quote('AMS', 'BOG', '2026-12-05', '2026-12-17', 500),
      quote('AMS', 'BOG', '2026-12-06', '2026-12-18', 510),
      quote('AMS', 'BOG', '2026-12-07', '2026-12-19', 520),
      quote('BRU', 'BOG', '2026-12-10', '2026-12-22', 700),
      quote('BRU', 'BOG', '2026-12-11', '2026-12-23', 710),
    ];
    const targets = selectForLive({ routes, pairs, cached, budget: 5, targetDays: 12 });
    const keys = targets.map((t) => pairKey(t.origin, t.destination, t.dep, t.ret));
    expect(keys).toContain('AMS-BOG-2026-12-05-2026-12-17');
    expect(keys).toContain('BRU-BOG-2026-12-10-2026-12-22');
    // DUS has no cached data, so it gets one sample date with the target trip length
    expect(targets.filter((t) => t.origin === 'DUS')).toHaveLength(1);
    expect(keys).toContain('AMS-BOG-2026-12-06-2026-12-18');
  });

  it('spreads the budget over routes and dates when nothing is cached', () => {
    const targets = selectForLive({ routes, pairs, cached: [], budget: 9, targetDays: 12 });
    expect(targets).toHaveLength(9);
    for (const [o] of routes) expect(targets.filter((t) => t.origin === o)).toHaveLength(3);
  });
});

describe('summarize', () => {
  it('ranks by price, drops options without flights, and groups per route and dates', () => {
    const noFlights = { ...quote('DUS', 'BOG', '2026-12-05', '2026-12-17', 100), liveNoResult: true };
    const res = summarize([
      quote('AMS', 'BOG', '2026-12-05', '2026-12-17', 600, 'live'),
      quote('AMS', 'BOG', '2026-12-06', '2026-12-18', 550),
      quote('BRU', 'BOG', '2026-12-05', '2026-12-17', 580, 'live'),
      noFlights,
    ]);
    expect(res.top.map((q) => q.price)).toEqual([550, 580, 600]);
    expect(res.byRoute.map((q) => `${q.origin}:${q.price}`)).toEqual(['AMS:550', 'BRU:580']);
    expect(res.byDates.find((q) => q.departDate === '2026-12-05')?.origin).toBe('BRU');
    expect(res.total).toBe(3);
  });
});

async function waitForDone(engine: SearchEngine, id: string) {
  for (let i = 0; i < 200; i++) {
    const job = engine.get(id)!;
    if (job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('search did not finish');
}

const request: SearchRequest = {
  origins: ['AMS', 'BRU', 'EIN'],
  destinations: ['BOG', 'MDE'],
  dates: {
    mode: 'flexible',
    windowStart: '2027-02-01',
    windowEnd: '2027-02-28',
    tripDays: 12,
    marginDays: 2,
    returnWithinWindow: false,
  },
  filters: { adults: 1, maxStops: null, minCheckedBags: 0, allowSelfTransfer: false },
  liveBudget: 12,
};

describe('SearchEngine', () => {
  it('runs the cached scan and live checks end to end', async () => {
    const engine = new SearchEngine(new DemoCachedProvider(), new DemoLiveProvider());
    const job = await waitForDone(engine, engine.start(request).id);
    expect(job.status).toBe('done');
    expect(job.cachedRequestsUsed).toBe(6 * 2); // 6 routes x (Feb-Feb, Feb-Mar)
    expect(job.liveRequestsUsed).toBe(12);
    expect(job.results.top[0].price).toBeGreaterThan(0);
    expect(job.results.byRoute.map((q) => `${q.origin}-${q.destination}`).sort()).toEqual([
      'AMS-BOG',
      'AMS-MDE',
      'BRU-BOG',
      'BRU-MDE',
      'EIN-BOG',
      'EIN-MDE',
    ]);
    expect(job.results.top.some((q) => q.source === 'live')).toBe(true);
  });

  it('stops live checks after a billing error and keeps cached results', async () => {
    let calls = 0;
    const broke: LivePriceProvider = {
      name: 'ignav',
      roundTrip: async () => {
        calls++;
        throw new ProviderError('Ignav: billing required', 402, true);
      },
      bookingLinks: async () => [],
    };
    const engine = new SearchEngine(new DemoCachedProvider(), broke);
    const job = await waitForDone(engine, engine.start(request).id);
    expect(job.status).toBe('done');
    expect(calls).toBeLessThanOrEqual(4); // only the requests already in flight
    expect(job.warnings.join()).toContain('billing required');
    expect(job.results.total).toBeGreaterThan(0);
  });

  it('works with live prices only', async () => {
    const engine = new SearchEngine(null, new DemoLiveProvider());
    const job = await waitForDone(engine, engine.start(request).id);
    expect(job.status).toBe('done');
    expect(job.liveRequestsUsed).toBe(12);
    expect(job.results.top.every((q) => q.source === 'live')).toBe(true);
  });

  it('applies the stops filter to cached prices', async () => {
    const cached: CachedPriceProvider = {
      name: 'travelpayouts',
      fetchMonth: async (q) => [
        {
          ...q,
          dep: '2027-02-03',
          ret: '2027-02-15',
          price: 400,
          currency: 'EUR',
          airline: 'XX',
          stopsOut: 1,
          stopsBack: 1,
        },
        {
          ...q,
          dep: '2027-02-04',
          ret: '2027-02-16',
          price: 700,
          currency: 'EUR',
          airline: 'KL',
          stopsOut: 0,
          stopsBack: 0,
        },
      ],
    };
    const engine = new SearchEngine(cached, null);
    const job = await waitForDone(
      engine,
      engine.start({ ...request, filters: { ...request.filters, maxStops: 0 } }).id,
    );
    expect(job.results.top.every((q) => q.price === 700)).toBe(true);
  });

  it('turns per-person cached prices into group totals, like live prices', async () => {
    const cached: CachedPriceProvider = {
      name: 'travelpayouts',
      fetchMonth: async (q) => [
        {
          ...q,
          dep: '2027-02-03',
          ret: '2027-02-15',
          price: 400,
          currency: 'EUR',
          airline: null,
          stopsOut: 1,
          stopsBack: 1,
        },
      ],
    };
    const engine = new SearchEngine(cached, null);
    const job = await waitForDone(engine, engine.start({ ...request, filters: { ...request.filters, adults: 2 } }).id);
    expect(job.results.top[0].price).toBe(800);
  });
});
