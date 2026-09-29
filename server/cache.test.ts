import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapWithConcurrency, TtlCache } from './cache';

afterEach(() => vi.useRealTimers());

describe('TtlCache', () => {
  it('forgets entries after their time to live', () => {
    vi.useFakeTimers();
    const cache = new TtlCache<number>(1000);
    cache.set('a', 1);
    vi.advanceTimersByTime(1000);
    expect(cache.get('a')).toBe(1);
    vi.advanceTimersByTime(1);
    expect(cache.get('a')).toBeUndefined();
  });

  it('evicts the oldest entry when full', () => {
    const cache = new TtlCache<number>(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('loads once and serves repeats from the cache, including null results', async () => {
    const cache = new TtlCache<string | null>(60_000);
    const load = vi.fn(async () => null);
    expect(await cache.getOrLoad('k', load)).toBeNull();
    expect(await cache.getOrLoad('k', load)).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache failed loads', async () => {
    const cache = new TtlCache<number>(60_000);
    await expect(cache.getOrLoad('k', () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    expect(await cache.getOrLoad('k', async () => 7)).toBe(7);
  });
});

describe('mapWithConcurrency', () => {
  it('keeps results in input order and never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapWithConcurrency([30, 10, 20, 5, 15], 2, async (ms, i) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight--;
      return i * 10;
    });
    expect(results).toEqual([0, 10, 20, 30, 40]);
    expect(peak).toBe(2);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});
