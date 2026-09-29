import { useRef, useState } from 'react';
import { addDays, daysBetween } from '../../../shared/dates';
import type { Quote } from '../../../shared/types';
import { formatDate, formatPrice, formatShortDate, weekday } from '../format';

const STEPS = 5;
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Step 5 = cheapest (darkest in light mode), step 1 = priciest. */
export function priceStep(price: number, min: number, max: number): number {
  if (max <= min) return STEPS;
  return STEPS - Math.min(STEPS - 1, Math.floor(((price - min) / (max - min)) * STEPS));
}

interface Props {
  byDates: Quote[];
  selected: { dep: string; ret: string } | null;
  onSelect: (dep: string, ret: string) => void;
  airportName: (code: string) => string;
}

interface Hover {
  quote: Quote;
  x: number;
  y: number;
}

/**
 * Heatmap of the cheapest price for every departure date (columns) and trip length (rows),
 * across all airports. Darker = cheaper, so the good weeks jump out.
 */
export function PriceCalendar({ byDates, selected, onSelect, airportName }: Props) {
  const [hover, setHover] = useState<Hover | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  if (byDates.length === 0) return null;

  const lookup = new Map(byDates.map((q) => [`${q.departDate}|${q.days}`, q]));
  const deps = byDates.map((q) => q.departDate).sort();
  const firstDep = deps[0];
  const lastDep = deps.at(-1)!;
  const columns = Array.from({ length: daysBetween(firstDep, lastDep) + 1 }, (_, i) => addDays(firstDep, i));
  const lengths = [...new Set(byDates.map((q) => q.days))].sort((a, b) => a - b);
  const prices = byDates.map((q) => q.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const cheapest = byDates.reduce((a, b) => (b.price < a.price ? b : a));
  const currency = cheapest.currency;

  const show = (quote: Quote, el: HTMLElement) => {
    const wrap = wrapRef.current!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    // Keep the tooltip inside the card horizontally.
    const x = Math.min(Math.max(r.left - wrap.left + r.width / 2, 140), wrap.width - 140);
    setHover({ quote, x, y: r.top - wrap.top });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          Cheapest: <strong className="text-ink">{formatPrice(cheapest.price, currency)}</strong>, leaving{' '}
          {formatDate(cheapest.departDate)} for {cheapest.days} days ({cheapest.origin} → {cheapest.destination})
        </p>
        <Legend min={min} max={max} currency={currency} />
      </div>

      {/* The tooltip lives outside the scroll container, so it isn't clipped by it. */}
      <div ref={wrapRef} className="relative" onMouseLeave={() => setHover(null)}>
        <div className="relative overflow-x-auto pb-2" onScroll={() => setHover(null)}>
          <div
            className="grid w-max gap-[2px]"
            style={{ gridTemplateColumns: `3.5rem repeat(${columns.length}, 24px)` }}
            role="grid"
            aria-label="Cheapest price by departure date and trip length"
          >
            <div role="columnheader" className="text-xs text-muted">
              Days ↓
            </div>
            {columns.map((d, i) => (
              <div key={d} role="columnheader" className="text-center text-[10px] leading-tight text-muted">
                <div className="h-3 whitespace-nowrap text-left">
                  {(i === 0 || d.endsWith('-01')) && formatShortDate(d).split(' ')[1]}
                </div>
                <div className={weekday(d) === 0 || weekday(d) === 6 ? 'font-semibold text-ink-2' : ''}>
                  {WEEKDAY[weekday(d)]}
                </div>
                <div className="tabular">{Number(d.slice(8))}</div>
              </div>
            ))}

            {lengths.map((len) => (
              <Row key={len} len={len}>
                {columns.map((dep) => {
                  const q = lookup.get(`${dep}|${len}`);
                  if (!q)
                    return (
                      <div
                        key={dep}
                        className="h-6 rounded-[4px]"
                        style={{ background: 'var(--empty-cell)' }}
                        role="gridcell"
                        aria-label="No price"
                      />
                    );
                  const step = priceStep(q.price, min, max);
                  const isCheapest = q === cheapest;
                  const isSelected = selected?.dep === q.departDate && selected.ret === q.returnDate;
                  return (
                    <button
                      key={dep}
                      type="button"
                      role="gridcell"
                      aria-selected={isSelected}
                      aria-label={`${formatPrice(q.price, q.currency)}, ${formatDate(q.departDate)} to ${formatDate(q.returnDate)}, ${q.origin} to ${q.destination}${q.source === 'live' ? ', live price' : ''}`}
                      className="relative flex h-6 items-center justify-center rounded-[4px] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                      style={{
                        background: `var(--seq-${step})`,
                        outline: isSelected ? '2px solid var(--text-primary)' : undefined,
                        outlineOffset: isSelected ? 1 : undefined,
                        boxShadow: isCheapest ? '0 0 0 2px var(--surface-1), 0 0 0 4px var(--accent)' : undefined,
                      }}
                      onMouseEnter={(e) => show(q, e.currentTarget)}
                      onFocus={(e) => show(q, e.currentTarget)}
                      onBlur={() => setHover(null)}
                      onClick={() => onSelect(q.departDate, q.returnDate)}
                    >
                      {q.source === 'live' && (
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: step >= 3 ? 'var(--seq-1)' : 'var(--seq-5)' }}
                        />
                      )}
                    </button>
                  );
                })}
              </Row>
            ))}
          </div>
        </div>

        {hover && (
          <div
            className="card pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full px-3 py-2 text-xs shadow-lg"
            style={{ left: hover.x, top: hover.y - 6 }}
          >
            <div className="tabular text-base font-semibold text-ink">
              {formatPrice(hover.quote.price, hover.quote.currency)}
            </div>
            <div className="whitespace-nowrap text-ink-2">
              {formatDate(hover.quote.departDate)} → {formatDate(hover.quote.returnDate)} · {hover.quote.days} days
            </div>
            <div className="whitespace-nowrap text-ink-2">
              {hover.quote.origin} {airportName(hover.quote.origin)} → {hover.quote.destination}{' '}
              {airportName(hover.quote.destination)}
            </div>
            <div className="text-muted">
              {hover.quote.source === 'live' ? 'Live price' : 'Cached price'} · click for all airports
            </div>
          </div>
        )}
      </div>
      <p className="text-xs text-muted">
        Each square is the cheapest price over all selected airports. ● = live checked price. Click a square to compare
        all airports for those dates.
      </p>
    </div>
  );
}

function Row({ len, children }: { len: number; children: React.ReactNode }) {
  return (
    <>
      <div role="rowheader" className="tabular flex items-center text-xs text-ink-2">
        {len} days
      </div>
      {children}
    </>
  );
}

function Legend({ min, max, currency }: { min: number; max: number; currency: string }) {
  const bin = (max - min) / STEPS;
  return (
    <div className="flex items-center gap-2 text-xs text-muted" aria-label="Color scale">
      <span>Cheaper</span>
      <div className="flex gap-[2px]">
        {Array.from({ length: STEPS }, (_, i) => {
          const step = STEPS - i;
          const lo = Math.round(min + i * bin);
          return (
            <div key={step} className="flex flex-col items-center gap-0.5">
              <div className="h-3 w-8 rounded-[3px]" style={{ background: `var(--seq-${step})` }} />
              <span className="tabular">
                {i === 0 ? formatPrice(min, currency) : i === STEPS - 1 ? formatPrice(max, currency) : `${lo}`}
              </span>
            </div>
          );
        })}
      </div>
      <span>Pricier</span>
    </div>
  );
}
