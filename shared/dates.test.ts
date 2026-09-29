import { describe, expect, it } from 'vitest';
import { addDays, generatePairs, monthsOf } from './dates';

describe('generatePairs', () => {
  it('exact dates without flex gives one pair', () => {
    const pairs = generatePairs(
      { mode: 'exact', departDate: '2026-12-10', returnDate: '2026-12-24', flexDays: 0 },
      '2026-10-01',
    );
    expect(pairs).toEqual([{ dep: '2026-12-10', ret: '2026-12-24', days: 14 }]);
  });

  it('exact dates with ±1 flex gives 3x3 pairs', () => {
    const pairs = generatePairs(
      { mode: 'exact', departDate: '2026-12-10', returnDate: '2026-12-24', flexDays: 1 },
      '2026-10-01',
    );
    expect(pairs).toHaveLength(9);
    expect(pairs.map((p) => p.days).sort((a, b) => a - b)).toEqual([12, 13, 13, 14, 14, 14, 15, 15, 16]);
  });

  it('flexible month: 1.5 to 2 weeks in December', () => {
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
    expect(pairs).toHaveLength(31 * 5);
    expect(pairs[0]).toEqual({ dep: '2026-12-01', ret: '2026-12-11', days: 10 });
    expect(pairs.at(-1)).toEqual({ dep: '2026-12-31', ret: '2027-01-14', days: 14 });
  });

  it('can require the whole trip inside the window', () => {
    const pairs = generatePairs(
      {
        mode: 'flexible',
        windowStart: '2026-12-01',
        windowEnd: '2026-12-31',
        tripDays: 14,
        marginDays: 0,
        returnWithinWindow: true,
      },
      '2026-10-01',
    );
    expect(pairs.at(-1)).toEqual({ dep: '2026-12-17', ret: '2026-12-31', days: 14 });
    expect(pairs.every((p) => p.ret <= '2026-12-31')).toBe(true);
  });

  it('skips departures in the past', () => {
    const pairs = generatePairs(
      {
        mode: 'flexible',
        windowStart: '2026-09-01',
        windowEnd: '2026-09-30',
        tripDays: 7,
        marginDays: 0,
        returnWithinWindow: false,
      },
      '2026-09-29',
    );
    expect(pairs.map((p) => p.dep)).toEqual(['2026-09-29', '2026-09-30']);
  });
});

describe('date helpers', () => {
  it('adds days across a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('lists distinct months', () => {
    expect(monthsOf(['2026-12-30', '2027-01-02', '2026-12-01'])).toEqual(['2026-12', '2027-01']);
  });
});
