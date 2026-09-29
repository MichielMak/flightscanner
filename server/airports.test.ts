import { describe, expect, it } from 'vitest';
import { resolveLocations, searchAirports, searchCountries } from './airports';

const TILBURG = { lat: 51.5555, lon: 5.0913 };

describe('resolveLocations', () => {
  it('finds the airports around Tilburg, large ones pre-selected', () => {
    const airports = resolveLocations([{ kind: 'near', ...TILBURG, radiusKm: 150, label: 'Tilburg' }]);
    const suggested = airports.filter((a) => a.suggested).map((a) => a.code);
    expect(suggested).toEqual(expect.arrayContaining(['EIN', 'AMS', 'BRU', 'DUS', 'RTM']));
    expect(airports.find((a) => a.code === 'EIN')?.distanceKm).toBeLessThan(30);
    expect(airports.every((a) => (a.distanceKm ?? 0) <= 150)).toBe(true);
  });

  it('expands a country and pre-selects only the big airports', () => {
    const airports = resolveLocations([{ kind: 'country', code: 'CO', label: 'Colombia' }]);
    expect(airports.length).toBeGreaterThan(10);
    expect(airports.filter((a) => a.suggested).map((a) => a.code)).toEqual(
      expect.arrayContaining(['BOG', 'MDE', 'CLO', 'CTG']),
    );
    expect(airports.find((a) => a.code === 'PSO')?.suggested).toBe(false);
  });

  it('merges duplicates from overlapping inputs', () => {
    const airports = resolveLocations([
      { kind: 'airport', code: 'PSO', label: 'Pasto' },
      { kind: 'country', code: 'CO', label: 'Colombia' },
    ]);
    expect(airports.filter((a) => a.code === 'PSO')).toHaveLength(1);
    // Explicitly picked airports stay selected even though they are small.
    expect(airports.find((a) => a.code === 'PSO')?.suggested).toBe(true);
  });
});

describe('search', () => {
  it('finds airports by code, city and name, ignoring accents', () => {
    expect(searchAirports('bog')[0].code).toBe('BOG');
    expect(searchAirports('medellin').map((a) => a.code)).toContain('MDE');
    expect(searchAirports('dusseldorf').map((a) => a.code)).toContain('DUS');
  });

  it('finds countries', () => {
    expect(searchCountries('colom')[0]).toMatchObject({ code: 'CO', name: 'Colombia' });
  });
});
