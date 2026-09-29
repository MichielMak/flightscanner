import { Hono } from 'hono';
import { requestId, type RequestIdVariables } from 'hono/request-id';
import { routePath } from 'hono/route';
import { z } from 'zod';
import type { LocationSuggestions } from '../shared/types';
import { resolveLocations, searchAirports, searchCountries } from './airports';
import { config } from './config';
import { geocode } from './geocode';
import { errorFields, log } from './log';
import { ProviderError } from './providers/types';
import type { SearchEngine } from './search';
import type { UsageCounter } from './usage';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const iata = z
  .string()
  .regex(/^[A-Za-z]{3}$/)
  .transform((s) => s.toUpperCase());

const locationSpec = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('airport'), code: iata, label: z.string() }),
  z.object({ kind: z.literal('country'), code: z.string().length(2), label: z.string() }),
  z.object({
    kind: z.literal('near'),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    radiusKm: z.number().min(1).max(1000),
    label: z.string(),
  }),
]);

const searchRequest = z.object({
  origins: z.array(iata).min(1).max(20),
  destinations: z.array(iata).min(1).max(50),
  dates: z.discriminatedUnion('mode', [
    z
      .object({
        mode: z.literal('exact'),
        departDate: isoDate,
        returnDate: isoDate,
        flexDays: z.number().int().min(0).max(7),
      })
      .refine((d) => d.returnDate >= d.departDate, 'Return date must be on or after the departure date'),
    z
      .object({
        mode: z.literal('flexible'),
        windowStart: isoDate,
        windowEnd: isoDate,
        tripDays: z.number().int().min(1).max(90),
        marginDays: z.number().int().min(0).max(14),
        returnWithinWindow: z.boolean(),
      })
      .refine((d) => d.windowEnd >= d.windowStart, 'Period end must be after its start')
      .refine((d) => d.windowEnd <= addDaysSafe(d.windowStart, 92), 'Period can be at most 3 months'),
  ]),
  filters: z.object({
    adults: z.number().int().min(1).max(9),
    maxStops: z.number().int().min(0).max(2).nullable(),
    minCheckedBags: z.number().int().min(0).max(2),
    allowSelfTransfer: z.boolean(),
  }),
  liveBudget: z.number().int().min(0).max(config.maxLiveBudget),
});

function addDaysSafe(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const checkRequest = z.object({ origin: iata, destination: iata, dep: isoDate, ret: isoDate });

export function createApp(engine: SearchEngine, usage: UsageCounter) {
  const app = new Hono<{ Variables: RequestIdVariables }>().basePath('/api');

  // Sets X-Request-Id (or keeps the caller's) so a browser error can be matched to its log line.
  app.use(requestId());
  app.use(async (c, next) => {
    const start = performance.now();
    await next();
    // After next() this is the route whose handler answered, not a catch-all registered later.
    const route = routePath(c);
    // The health check and the result polling (every 800 ms per search) would drown everything else.
    if (route === '/api/health' || (route === '/api/search/:id' && c.res.status < 400)) return;
    const fields = {
      requestId: c.get('requestId'),
      method: c.req.method,
      route,
      status: c.res.status,
      durationMs: Math.round(performance.now() - start),
    };
    if (c.res.status >= 500) log.error('http.request', fields);
    else log.info('http.request', fields);
  });

  app.onError((err, c) => {
    if (err instanceof z.ZodError) {
      return c.json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    }
    if (err instanceof ProviderError) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
      log.warn('provider.error', { requestId: c.get('requestId'), status, fatal: err.fatal, error: err.message });
      return c.json({ error: err.message }, status as 400);
    }
    log.error('http.unhandled_error', { requestId: c.get('requestId'), ...errorFields(err) });
    return c.json({ error: 'Internal error' }, 500);
  });

  // Liveness only: no calls to price providers, so it is cheap enough for a Docker health check.
  app.get('/health', (c) =>
    c.json({ status: 'ok', version: config.version, uptimeSeconds: Math.round(process.uptime()) }),
  );

  app.get('/config', (c) =>
    c.json({
      version: config.version,
      demo: config.demo,
      providers: engine.providers,
      defaultLiveBudget: config.defaultLiveBudget,
      maxLiveBudget: config.maxLiveBudget,
      ignavRequestsUsed: usage.ignavRequests,
    }),
  );

  app.get('/locations', async (c) => {
    const q = c.req.query('q') ?? '';
    const airports = searchAirports(q);
    const countries = searchCountries(q);
    let places: LocationSuggestions['places'] = [];
    // Skip the (slow, rate limited) geocoder when the query is clearly an airport code.
    if (q.trim().length >= 3 && !(q.trim().length === 3 && airports[0]?.code === q.trim().toUpperCase())) {
      places = await geocode(q).catch((e: unknown) => {
        log.warn('geocode.failed', { requestId: c.get('requestId'), ...errorFields(e) });
        return [];
      });
    }
    return c.json({ airports, countries, places } satisfies LocationSuggestions);
  });

  app.post('/locations/resolve', async (c) => {
    const { specs } = z.object({ specs: z.array(locationSpec).max(20) }).parse(await c.req.json());
    return c.json(resolveLocations(specs));
  });

  app.post('/search', async (c) => {
    const request = searchRequest.parse(await c.req.json());
    return c.json(engine.start(request), 202);
  });

  app.get('/search/:id', (c) => {
    const job = engine.get(c.req.param('id'));
    return job ? c.json(job) : c.json({ error: 'Search not found (it may have expired)' }, 404);
  });

  app.get('/search/:id/dates', (c) => {
    const dep = isoDate.parse(c.req.query('dep'));
    const ret = isoDate.parse(c.req.query('ret'));
    const quotes = engine.quotesForDates(c.req.param('id'), dep, ret);
    return quotes ? c.json(quotes) : c.json({ error: 'Search not found' }, 404);
  });

  app.post('/search/:id/check', async (c) => {
    const target = checkRequest.parse(await c.req.json());
    return c.json(await engine.checkOne(c.req.param('id'), target));
  });

  app.post('/booking-links', async (c) => {
    const { itineraryId } = z.object({ itineraryId: z.string().min(1) }).parse(await c.req.json());
    const live = engine.liveProvider;
    if (!live) return c.json({ error: 'No live price provider configured' }, 400);
    return c.json(await live.bookingLinks(itineraryId));
  });

  return app;
}
