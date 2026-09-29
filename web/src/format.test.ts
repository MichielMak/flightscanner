import { describe, expect, it } from 'vitest';
import { formatDuration, formatPrice, googleFlightsUrl, skyscannerUrl, stopsLabel } from './format';

const trip = { origin: 'AMS', destination: 'BOG', departDate: '2026-12-10', returnDate: '2026-12-22' };

describe('format', () => {
  it('formats prices without decimals', () => {
    expect(formatPrice(1234.6, 'EUR')).toBe('€1,235');
  });

  it('formats durations as hours and zero-padded minutes', () => {
    expect(formatDuration(725)).toBe('12h05');
    expect(formatDuration(null)).toBe('');
  });

  it('labels stops', () => {
    expect(stopsLabel(0)).toBe('Direct');
    expect(stopsLabel(1, ['MAD'])).toBe('1 stop via MAD');
    expect(stopsLabel(2, ['MAD', 'LIS'])).toBe('2 stops via MAD, LIS');
    expect(stopsLabel(null)).toBe('');
  });

  it('builds deep links with the exact route and dates', () => {
    expect(skyscannerUrl(trip)).toBe('https://www.skyscanner.nl/transport/vluchten/ams/bog/261210/261222/');
    const google = new URL(googleFlightsUrl(trip));
    expect(google.searchParams.get('q')).toBe('Flights to BOG from AMS on 2026-12-10 through 2026-12-22');
  });
});
