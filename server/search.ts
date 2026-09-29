import { randomUUID } from 'node:crypto';
import type { ProviderInfo, Quote, SearchJob, SearchRequest, SearchResults } from '../shared/types';
import { airportByCode } from './airports';
import { mapWithConcurrency } from './cache';
import { daysBetween, generatePairs, monthsOf, pairKey, type DatePair } from '../shared/dates';
import { ProviderError, type CachedPrice, type CachedPriceProvider, type LivePriceProvider } from './providers/types';

export interface LiveTarget {
  origin: string;
  destination: string;
  dep: string;
  ret: string;
}

type Route = [origin: string, destination: string];

const CACHED_CONCURRENCY = 4;
const LIVE_CONCURRENCY = 4;
const TOP_N = 40;
const MAX_CACHED_CALLS = 800;
const JOB_TTL_MS = 6 * 3_600_000;

/** Up to `n` pairs closest to the wanted trip length, spread evenly over the departure dates. */
export function spreadPairs(pairs: DatePair[], targetDays: number, n: number): DatePair[] {
  if (n <= 0 || pairs.length === 0) return [];
  const closest = Math.min(...pairs.map((p) => Math.abs(p.days - targetDays)));
  const pool = pairs
    .filter((p) => Math.abs(p.days - targetDays) === closest)
    .sort((a, b) => a.dep.localeCompare(b.dep));
  if (n >= pool.length) return pool;
  if (n === 1) return [pool[Math.floor((pool.length - 1) / 2)]];
  return Array.from({ length: n }, (_, i) => pool[Math.round((i * (pool.length - 1)) / (n - 1))]);
}

/**
 * Decides which (route, dates) combinations get a live (paid) price check.
 *
 * Checking everything is usually far over budget (8 airports x 6 airports x 150 date pairs = 7,200 calls),
 * so cached prices act as a map of where the cheap fares probably are:
 *   1. the cheapest cached date for each route, so every airport gets compared fairly;
 *   2. one sample date for routes the cache knows nothing about;
 *   3. whatever budget is left goes to the next-cheapest cached options overall.
 * Without any cached prices the budget is spread evenly over routes and departure dates instead.
 */
export function selectForLive(opts: {
  routes: Route[];
  pairs: DatePair[];
  cached: Quote[];
  budget: number;
  targetDays: number;
}): LiveTarget[] {
  const { routes, pairs, budget, targetDays } = opts;
  const toTarget = (o: string, d: string, p: { dep: string; ret: string }): LiveTarget => ({
    origin: o,
    destination: d,
    dep: p.dep,
    ret: p.ret,
  });
  const byPrice = [...opts.cached].sort((a, b) => a.price - b.price);

  if (routes.length * pairs.length <= budget) {
    const rank = new Map(byPrice.map((q, i) => [pairKey(q.origin, q.destination, q.departDate, q.returnDate), i]));
    return routes
      .flatMap(([o, d]) => pairs.map((p) => toTarget(o, d, p)))
      .sort(
        (a, b) =>
          (rank.get(pairKey(a.origin, a.destination, a.dep, a.ret)) ?? Infinity) -
          (rank.get(pairKey(b.origin, b.destination, b.dep, b.ret)) ?? Infinity),
      );
  }

  if (byPrice.length === 0) {
    const perRoute = Math.floor(budget / routes.length);
    const remainder = budget % routes.length;
    return routes
      .flatMap(([o, d], i) =>
        spreadPairs(pairs, targetDays, perRoute + (i < remainder ? 1 : 0)).map((p) => toTarget(o, d, p)),
      )
      .slice(0, budget);
  }

  const selected = new Map<string, LiveTarget>();
  const take = (items: LiveTarget[], max: number) => {
    let added = 0;
    for (const t of items) {
      if (added >= max || selected.size >= budget) break;
      const key = pairKey(t.origin, t.destination, t.dep, t.ret);
      if (selected.has(key)) continue;
      selected.set(key, t);
      added++;
    }
  };
  const fromQuote = (q: Quote) => toTarget(q.origin, q.destination, { dep: q.departDate, ret: q.returnDate });

  const bestPerRoute = new Map<string, Quote>();
  for (const q of byPrice)
    if (!bestPerRoute.has(`${q.origin}-${q.destination}`)) bestPerRoute.set(`${q.origin}-${q.destination}`, q);
  const routeBests = [...bestPerRoute.values()].map(fromQuote);
  const sample = spreadPairs(pairs, targetDays, 1)[0];
  const unknownRoutes = routes
    .filter(([o, d]) => !bestPerRoute.has(`${o}-${d}`))
    .map(([o, d]) => toTarget(o, d, sample));

  take(routeBests, Math.ceil(budget * 0.5));
  take(unknownRoutes, Math.floor(budget * 0.2));
  take(byPrice.map(fromQuote), Infinity);
  take(routeBests, Infinity);
  take(unknownRoutes, Infinity);
  return [...selected.values()];
}

/** Collapses all quotes into the three views the UI shows. Live results always replace cached ones. */
export function summarize(quotes: Iterable<Quote>): SearchResults {
  const usable = [...quotes].filter((q) => !q.liveNoResult).sort((a, b) => a.price - b.price);
  const cheapestBy = (key: (q: Quote) => string) => {
    const best = new Map<string, Quote>();
    for (const q of usable) if (!best.has(key(q))) best.set(key(q), q);
    return [...best.values()];
  };
  return {
    top: usable.slice(0, TOP_N),
    byRoute: cheapestBy((q) => `${q.origin}-${q.destination}`),
    byDates: cheapestBy((q) => `${q.departDate}|${q.returnDate}`),
    total: usable.length,
  };
}

interface JobState {
  job: Omit<SearchJob, 'results'>;
  quotes: Map<string, Quote>;
}

export class SearchEngine {
  private jobs = new Map<string, JobState>();

  constructor(
    private cached: CachedPriceProvider | null,
    private live: LivePriceProvider | null,
  ) {}

  get providers(): ProviderInfo {
    return { cached: this.cached?.name ?? 'none', live: this.live?.name ?? 'none' };
  }

  get liveProvider(): LivePriceProvider | null {
    return this.live;
  }

  start(request: SearchRequest): SearchJob {
    this.cleanup();
    const state: JobState = {
      job: {
        id: randomUUID(),
        status: 'running',
        phase: 'Starting',
        progress: { done: 0, total: 0 },
        request,
        warnings: [],
        liveRequestsUsed: 0,
        cachedRequestsUsed: 0,
        providers: this.providers,
        startedAt: new Date().toISOString(),
      },
      quotes: new Map(),
    };
    this.jobs.set(state.job.id, state);
    this.run(state).catch((e: unknown) => {
      state.job.status = 'error';
      state.job.error = e instanceof Error ? e.message : String(e);
      state.job.finishedAt = new Date().toISOString();
    });
    return this.snapshot(state);
  }

  get(id: string): SearchJob | undefined {
    const state = this.jobs.get(id);
    return state && this.snapshot(state);
  }

  /** Every route's price for one date pair, cheapest first. */
  quotesForDates(id: string, dep: string, ret: string): Quote[] | undefined {
    const state = this.jobs.get(id);
    if (!state) return undefined;
    return [...state.quotes.values()]
      .filter((q) => q.departDate === dep && q.returnDate === ret)
      .sort((a, b) => Number(a.liveNoResult ?? 0) - Number(b.liveNoResult ?? 0) || a.price - b.price);
  }

  /** Live-checks a single option on demand (e.g. a cached price the user wants confirmed). */
  async checkOne(id: string, target: LiveTarget): Promise<Quote | null> {
    const state = this.jobs.get(id);
    if (!state) throw new ProviderError('Search not found', 404);
    if (!this.live) throw new ProviderError('No live price provider configured', 400);
    state.job.liveRequestsUsed++;
    const result = await this.live.roundTrip({ ...target, filters: state.job.request.filters });
    this.applyLive(state, target, result);
    return state.quotes.get(pairKey(target.origin, target.destination, target.dep, target.ret)) ?? null;
  }

  private snapshot(state: JobState): SearchJob {
    return structuredClone({ ...state.job, results: summarize(state.quotes.values()) });
  }

  private cleanup() {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, s] of this.jobs) if (Date.parse(s.job.startedAt) < cutoff) this.jobs.delete(id);
  }

  private applyCached(state: JobState, c: CachedPrice) {
    // Cached prices are per person; live prices are for the whole group. Compare totals.
    const price = c.price * state.job.request.filters.adults;
    const key = pairKey(c.origin, c.destination, c.dep, c.ret);
    const existing = state.quotes.get(key);
    if (existing && (existing.source === 'live' || existing.price <= price)) return;
    state.quotes.set(key, {
      origin: c.origin,
      destination: c.destination,
      departDate: c.dep,
      returnDate: c.ret,
      days: daysBetween(c.dep, c.ret),
      price,
      currency: c.currency,
      source: 'cached',
      cachedInfo: { airline: c.airline, stopsOut: c.stopsOut, stopsBack: c.stopsBack },
    });
  }

  private applyLive(state: JobState, t: LiveTarget, result: Awaited<ReturnType<LivePriceProvider['roundTrip']>>) {
    const key = pairKey(t.origin, t.destination, t.dep, t.ret);
    const existing = state.quotes.get(key);
    if (!result) {
      if (existing) existing.liveNoResult = true;
      return;
    }
    state.quotes.set(key, {
      origin: t.origin,
      destination: t.destination,
      departDate: t.dep,
      returnDate: t.ret,
      days: daysBetween(t.dep, t.ret),
      price: result.price,
      currency: result.currency,
      source: 'live',
      itinerary: result.itinerary,
      ...(existing?.cachedInfo && { cachedInfo: existing.cachedInfo }),
    });
  }

  private async run(state: JobState) {
    const { job } = state;
    const req = job.request;
    const pairs = generatePairs(req.dates);
    if (pairs.length === 0) throw new Error('No valid date combinations. Are the dates in the past?');

    const size = (code: string) => (airportByCode(code)?.size === 'large' ? 0 : 1);
    const routes: Route[] = req.origins
      .flatMap((o) => req.destinations.filter((d) => d !== o).map((d): Route => [o, d]))
      .sort((a, b) => size(a[0]) + size(a[1]) - (size(b[0]) + size(b[1])));
    if (routes.length === 0) throw new Error('Pick at least one departure and one arrival airport.');

    const pairSet = new Set(pairs.map((p) => `${p.dep}|${p.ret}`));
    const depMonths = monthsOf(pairs.map((p) => p.dep));
    const retMonths = monthsOf(pairs.map((p) => p.ret));
    const monthPairs = depMonths.flatMap((dm) => retMonths.filter((rm) => rm >= dm).map((rm) => [dm, rm] as const));
    const maxStops = req.filters.maxStops;
    const liveEstimate = this.live ? Math.min(req.liveBudget, routes.length * pairs.length) : 0;

    // Stage 1: cached prices for every route and month (free).
    if (this.cached) {
      const calls = routes.flatMap(([o, d]) => monthPairs.map(([dm, rm]) => ({ o, d, dm, rm })));
      if (calls.length > MAX_CACHED_CALLS) {
        throw new Error(
          `Too many routes and months (${calls.length} lookups). Pick fewer airports or a shorter period.`,
        );
      }
      job.phase = 'Scanning cached prices';
      job.progress = { done: 0, total: calls.length + liveEstimate };
      let failures = 0;
      let lastError = '';
      let fatal = false;
      await mapWithConcurrency(calls, CACHED_CONCURRENCY, async ({ o, d, dm, rm }) => {
        if (fatal) return;
        try {
          const prices = await this.cached!.fetchMonth({
            origin: o,
            destination: d,
            depMonth: dm,
            retMonth: rm,
            directOnly: maxStops === 0,
          });
          job.cachedRequestsUsed++;
          for (const p of prices) {
            if (!pairSet.has(`${p.dep}|${p.ret}`)) continue;
            if (maxStops !== null && ((p.stopsOut ?? 0) > maxStops || (p.stopsBack ?? 0) > maxStops)) continue;
            this.applyCached(state, p);
          }
        } catch (e) {
          failures++;
          lastError = e instanceof Error ? e.message : String(e);
          if (e instanceof ProviderError && e.fatal) fatal = true;
        } finally {
          job.progress.done++;
        }
      });
      if (failures)
        job.warnings.push(`Cached price lookup failed for ${failures} of ${calls.length} requests (${lastError}).`);
    } else {
      job.warnings.push('No TRAVELPAYOUTS_TOKEN set, so the month scan only uses live checks spread over the dates.');
    }

    // Stage 2: live (paid) checks on the most promising options.
    if (!this.live) {
      job.warnings.push('No IGNAV_API_KEY set: showing cached prices only. These can be days old.');
    } else {
      const targetDays =
        req.dates.mode === 'exact' ? daysBetween(req.dates.departDate, req.dates.returnDate) : req.dates.tripDays;
      const targets = selectForLive({
        routes,
        pairs,
        cached: [...state.quotes.values()],
        budget: req.liveBudget,
        targetDays,
      });
      job.phase = 'Checking live prices';
      job.progress.total = job.progress.done + targets.length;
      let failures = 0;
      let noFlights = 0;
      let lastError = '';
      let stopped = false;
      await mapWithConcurrency(targets, LIVE_CONCURRENCY, async (t) => {
        if (stopped) return;
        try {
          job.liveRequestsUsed++;
          const result = await this.live!.roundTrip({ ...t, filters: req.filters });
          if (!result) noFlights++;
          this.applyLive(state, t, result);
        } catch (e) {
          failures++;
          lastError = e instanceof Error ? e.message : String(e);
          if (e instanceof ProviderError && e.fatal) {
            stopped = true;
            job.warnings.push(`Live checks stopped: ${lastError}`);
          }
        } finally {
          job.progress.done++;
        }
      });
      if (failures && !stopped) job.warnings.push(`${failures} live checks failed (${lastError}).`);
      if (noFlights) job.warnings.push(`${noFlights} live checks found no flights matching your filters.`);
    }

    job.phase = 'Done';
    job.progress.done = job.progress.total;
    job.status = 'done';
    job.finishedAt = new Date().toISOString();
  }
}
