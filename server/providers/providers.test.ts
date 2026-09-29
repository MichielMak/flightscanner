import { describe, expect, it } from 'vitest';
import { cheapestItinerary } from './ignav';
import { parseTravelpayouts } from './travelpayouts';

const segment = (from: string, to: string, flight: string) => ({
  marketing_carrier_code: flight.slice(0, 2),
  flight_number: flight.slice(2),
  operating_carrier_name: 'KLM',
  departure_airport: from,
  departure_time_local: '2026-12-10T10:00:00',
  arrival_airport: to,
  arrival_time_local: '2026-12-10T15:00:00',
});

describe('Ignav', () => {
  it('picks the cheapest real fare and ignores 0-amount placeholders', () => {
    const result = cheapestItinerary([
      {
        ignav_id: 'a',
        price: { amount: 0, currency: 'EUR', status: 'unverified' },
        outbound: { carrier: 'X', duration_minutes: 1, segments: [] },
      },
      {
        ignav_id: 'b',
        price: { amount: 812, currency: 'EUR', status: 'verified' },
        outbound: { carrier: 'KLM', duration_minutes: 660, segments: [segment('AMS', 'BOG', 'KL727')] },
        inbound: {
          carrier: 'Iberia',
          duration_minutes: 800,
          segments: [segment('BOG', 'MAD', 'IB6586'), segment('MAD', 'AMS', 'IB3252')],
        },
        requires_self_transfer: false,
        bags: { carry_on: 1, checked: 1 },
      },
      {
        ignav_id: 'c',
        price: { amount: 950, currency: 'EUR', status: 'verified' },
        outbound: { carrier: 'KLM', duration_minutes: 660, segments: [segment('AMS', 'BOG', 'KL727')] },
      },
    ]);
    expect(result?.price).toBe(812);
    expect(result?.itinerary.ignavId).toBe('b');
    expect(result?.itinerary.outbound).toMatchObject({ stops: 0, via: [], flights: ['KL727'] });
    expect(result?.itinerary.inbound).toMatchObject({ stops: 1, via: ['MAD'], flights: ['IB6586', 'IB3252'] });
    expect(result?.itinerary.checkedBags).toBe(1);
  });

  it('returns null when there are no flights', () => {
    expect(cheapestItinerary([])).toBeNull();
  });
});

describe('Travelpayouts', () => {
  const query = { origin: 'AMS', destination: 'BOG', depMonth: '2026-12', retMonth: '2026-12', directOnly: false };

  it('maps tickets to local dates and filters out other airports', () => {
    const prices = parseTravelpayouts(query, {
      success: true,
      currency: 'eur',
      data: [
        {
          origin_airport: 'AMS',
          destination_airport: 'BOG',
          price: 689,
          airline: 'KL',
          departure_at: '2026-12-10T23:35:00+01:00',
          return_at: '2026-12-24T19:10:00-05:00',
          transfers: 0,
          return_transfers: 1,
        },
        {
          origin_airport: 'RTM',
          destination_airport: 'BOG',
          price: 500,
          departure_at: '2026-12-10',
          return_at: '2026-12-20',
        },
        { origin_airport: 'AMS', destination_airport: 'BOG', price: 600, departure_at: '2026-12-11' },
      ],
    });
    expect(prices).toEqual([
      {
        origin: 'AMS',
        destination: 'BOG',
        dep: '2026-12-10',
        ret: '2026-12-24',
        price: 689,
        currency: 'EUR',
        airline: 'KL',
        stopsOut: 0,
        stopsBack: 1,
      },
    ]);
  });

  it('throws on an API error', () => {
    expect(() => parseTravelpayouts(query, { success: false, error: 'bad token' })).toThrow('bad token');
  });
});
