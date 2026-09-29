import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchJob, SearchRequest } from '../shared/types';
import { createApp } from './app';
import { log } from './log';
import { DemoCachedProvider, DemoLiveProvider } from './providers/demo';
import { ProviderError, type LivePriceProvider } from './providers/types';
import { SearchEngine } from './search';
import { UsageCounter } from './usage';

type LogLine = Record<string, unknown> & { level: string; event: string };

let lines: LogLine[];

beforeEach(() => {
  vi.stubEnv('LOG_LEVEL', 'info');
  lines = [];
  const capture = (chunk: string | Uint8Array) => {
    for (const line of String(chunk).split('\n')) if (line.startsWith('{')) lines.push(JSON.parse(line) as LogLine);
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(capture as typeof process.stdout.write);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture as typeof process.stderr.write);
  return () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  };
});

const events = (name: string) => lines.filter((l) => l.event === name);
const tempDir = () => mkdtempSync(join(tmpdir(), 'flightscanner-obs-'));

const request: SearchRequest = {
  origins: ['AMS'],
  destinations: ['BOG'],
  dates: { mode: 'exact', departDate: '2027-02-03', returnDate: '2027-02-15', flexDays: 1 },
  filters: { adults: 1, maxStops: null, minCheckedBags: 0, allowSelfTransfer: false },
  liveBudget: 3,
};

async function waitForDone(engine: SearchEngine, id: string) {
  await vi.waitFor(() => expect(engine.get(id)?.status).not.toBe('running'), { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 0)); // the finished log is written just after the status flips
  return engine.get(id)!;
}

describe('log', () => {
  it('writes one JSON object per line with time, level and event', () => {
    log.info('thing.happened', { count: 2 });
    expect(lines).toEqual([{ time: expect.any(String), level: 'info', event: 'thing.happened', count: 2 }]);
    expect(Number.isNaN(Date.parse(lines[0].time as string))).toBe(false);
  });

  it('sends warnings and errors to stderr', () => {
    log.warn('a');
    log.error('b');
    expect(process.stderr.write).toHaveBeenCalledTimes(2);
    expect(process.stdout.write).not.toHaveBeenCalled();
  });

  it('drops lines below LOG_LEVEL', () => {
    vi.stubEnv('LOG_LEVEL', 'warn');
    log.debug('a');
    log.info('b');
    log.warn('c');
    expect(lines.map((l) => l.event)).toEqual(['c']);
  });
});

describe('HTTP', () => {
  // Mounted like server/index.ts, including the catch-all that serves the web app.
  const setup = (live: LivePriceProvider | null = new DemoLiveProvider()) => {
    const app = new Hono();
    app.route('/', createApp(new SearchEngine(new DemoCachedProvider(), live), new UsageCounter(tempDir())));
    app.use('/*', async (_c, next) => next());
    app.get('*', (c) => c.text('index.html'));
    return app;
  };

  it('answers the health check without logging it', async () => {
    const res = await setup().request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', version: expect.any(String) });
    expect(lines).toEqual([]);
  });

  it('logs requests by route with the request ID sent back to the browser', async () => {
    const res = await setup().request('/api/search', {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { 'Content-Type': 'application/json' },
    });
    const id = res.headers.get('X-Request-Id');
    expect(id).toBeTruthy();
    expect(events('http.request')).toEqual([
      expect.objectContaining({
        level: 'info',
        requestId: id,
        method: 'POST',
        route: '/api/search',
        status: 202,
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it('keeps an incoming request ID', async () => {
    const res = await setup().request('/api/config', { headers: { 'X-Request-Id': 'from-proxy' } });
    expect(res.headers.get('X-Request-Id')).toBe('from-proxy');
    expect(events('http.request')[0]).toMatchObject({ requestId: 'from-proxy' });
  });

  it('skips successful result polling but logs a poll for a missing job', async () => {
    const app = setup();
    const job = (await (
      await app.request('/api/search', {
        method: 'POST',
        body: JSON.stringify(request),
        headers: { 'Content-Type': 'application/json' },
      })
    ).json()) as SearchJob;
    lines.length = 0;

    await app.request(`/api/search/${job.id}`);
    expect(events('http.request')).toEqual([]);

    await app.request('/api/search/gone');
    expect(events('http.request')).toEqual([expect.objectContaining({ route: '/api/search/:id', status: 404 })]);
  });

  it('logs unexpected errors with their stack at error level', async () => {
    const broken: LivePriceProvider = {
      name: 'ignav',
      roundTrip: async () => null,
      bookingLinks: async () => {
        throw new Error('boom');
      },
    };
    const res = await setup(broken).request('/api/booking-links', {
      method: 'POST',
      body: JSON.stringify({ itineraryId: 'x' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(500);
    const [error] = events('http.unhandled_error');
    expect(error).toMatchObject({ level: 'error', requestId: res.headers.get('X-Request-Id'), error: 'boom' });
    expect(error.stack).toContain('boom');
    expect(events('http.request')[0]).toMatchObject({ level: 'error', status: 500 });
  });
});

describe('search logs', () => {
  it('logs the start and the outcome of a search', async () => {
    const engine = new SearchEngine(new DemoCachedProvider(), new DemoLiveProvider());
    const job = await waitForDone(engine, engine.start(request).id);

    const own = (name: string) => events(name).filter((l) => l.searchId === job.id);
    expect(own('search.started')).toEqual([
      expect.objectContaining({ searchId: job.id, origins: 1, destinations: 1, dateMode: 'exact', liveBudget: 3 }),
    ]);
    expect(own('search.finished')).toEqual([
      expect.objectContaining({
        level: 'info',
        searchId: job.id,
        status: 'done',
        liveRequests: 3,
        cachedRequests: job.cachedRequestsUsed,
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it('logs a fatal provider error once, even with several requests in flight', async () => {
    const broke: LivePriceProvider = {
      name: 'ignav',
      roundTrip: async () => {
        throw new ProviderError('Ignav: billing required', 402, true);
      },
      bookingLinks: async () => [],
    };
    const engine = new SearchEngine(null, broke);
    const job = await waitForDone(engine, engine.start(request).id);

    expect(events('provider.fatal').filter((l) => l.searchId === job.id)).toEqual([
      expect.objectContaining({ level: 'error', provider: 'ignav', status: 402, error: 'Ignav: billing required' }),
    ]);
  });
});

describe('Ignav free tier', () => {
  const counterAt = (count: number) => {
    const dir = tempDir();
    writeFileSync(join(dir, 'usage.json'), JSON.stringify({ ignavRequests: count }));
    return new UsageCounter(dir);
  };

  it('warns once when 80% of the free requests are used', () => {
    const usage = counterAt(798);
    usage.increment();
    expect(events('ignav.free_tier')).toEqual([]);
    usage.increment();
    usage.increment();
    expect(events('ignav.free_tier')).toEqual([
      expect.objectContaining({ level: 'warn', ignavRequests: 800, message: 'Ignav free requests 80% used' }),
    ]);
  });

  it('warns when the free requests are used up', () => {
    counterAt(999).increment();
    expect(events('ignav.free_tier')).toEqual([
      expect.objectContaining({ ignavRequests: 1000, message: expect.stringContaining('now billed') }),
    ]);
  });
});
