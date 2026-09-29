import type { Quote } from '../../../shared/types';
import { formatPrice, formatShortDate } from '../format';

interface Props {
  origins: string[];
  destinations: string[];
  byRoute: Quote[];
  airportName: (code: string) => string;
}

/** Cheapest price per airport pair, so you can see at a glance which airport is worth the drive. */
export function RouteMatrix({ origins, destinations, byRoute, airportName }: Props) {
  const lookup = new Map(byRoute.map((q) => [`${q.origin}-${q.destination}`, q]));
  const cheapest = byRoute[0]?.price;
  // Only show airports that have at least one price, cheapest first.
  const bestFor = (codes: string[], side: 'origin' | 'destination') =>
    codes
      .map((c) => ({ c, p: Math.min(...byRoute.filter((q) => q[side] === c).map((q) => q.price)) }))
      .filter((x) => Number.isFinite(x.p))
      .sort((a, b) => a.p - b.p)
      .map((x) => x.c);
  const rows = bestFor(origins, 'origin');
  const cols = bestFor(destinations, 'destination');
  const missingRows = origins.filter((o) => !rows.includes(o));
  const missingCols = destinations.filter((d) => !cols.includes(d));

  if (rows.length === 0) return <p className="text-sm text-muted">No prices yet.</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-x-auto">
        <table className="text-sm">
          <caption className="sr-only">Cheapest price per departure and arrival airport</caption>
          <thead>
            <tr>
              <th className="p-2 text-left text-xs font-normal text-muted">From ↓ / To →</th>
              {cols.map((d) => (
                <th key={d} className="p-2 text-left font-semibold" title={airportName(d)}>
                  {d}
                  <div className="text-xs font-normal text-muted">{airportName(d)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o} className="border-t border-hairline">
                <th className="p-2 text-left font-semibold" title={airportName(o)}>
                  {o}
                  <div className="text-xs font-normal text-muted">{airportName(o)}</div>
                </th>
                {cols.map((d) => {
                  const q = lookup.get(`${o}-${d}`);
                  const best = q && q.price === cheapest;
                  return (
                    <td key={d} className="p-2 align-top">
                      {q ? (
                        <div className={best ? 'rounded-md px-1.5 py-0.5 ring-2 ring-accent' : 'px-1.5 py-0.5'}>
                          <div className="tabular font-semibold">
                            {formatPrice(q.price, q.currency)}
                            {best && <span className="ml-1 text-xs font-medium text-accent">cheapest</span>}
                          </div>
                          <div className="text-xs text-muted">
                            {formatShortDate(q.departDate)} – {formatShortDate(q.returnDate)} ·{' '}
                            {q.source === 'live' ? 'live' : 'cached'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted">–</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(missingRows.length > 0 || missingCols.length > 0) && (
        <p className="text-xs text-muted">No prices found for: {[...missingRows, ...missingCols].join(', ')}.</p>
      )}
    </div>
  );
}
