import { useState } from 'react';
import type { BookingLink, LegSummary, Quote } from '../../../shared/types';
import { api } from '../api';
import {
  formatDate,
  formatDuration,
  formatPrice,
  formatTime,
  googleFlightsUrl,
  skyscannerUrl,
  stopsLabel,
} from '../format';

export interface QuoteActions {
  /** null when live checks are not available */
  checkLive: ((q: Quote) => Promise<void>) | null;
  canBook: boolean;
  airportName: (code: string) => string;
}

export function SourceBadge({ quote }: { quote: Quote }) {
  return quote.source === 'live' ? (
    <span
      className="rounded bg-accent/15 px-1.5 py-0.5 text-xs font-medium text-accent"
      title="Live price, checked just now"
    >
      ✓ Live
    </span>
  ) : (
    <span
      className="rounded border border-hairline px-1.5 py-0.5 text-xs text-muted"
      title="From a price cache, can be a few days old"
    >
      Cached
    </span>
  );
}

function LegLine({ label, leg }: { label: string; leg: LegSummary }) {
  return (
    <div className="text-xs text-ink-2">
      <span className="text-muted">{label}</span> {formatTime(leg.departLocal)}–{formatTime(leg.arriveLocal)} ·{' '}
      {leg.carrier} · {stopsLabel(leg.stops, leg.via)} · {formatDuration(leg.durationMinutes)}
    </div>
  );
}

function FlightInfo({ quote }: { quote: Quote }) {
  if (quote.itinerary) {
    return (
      <div className="flex flex-col gap-0.5">
        <LegLine label="Out" leg={quote.itinerary.outbound} />
        {quote.itinerary.inbound && <LegLine label="Back" leg={quote.itinerary.inbound} />}
        {quote.itinerary.selfTransfer && (
          <div className="text-xs text-muted">⚠ Separate tickets: missed connections are your risk</div>
        )}
      </div>
    );
  }
  const c = quote.cachedInfo;
  if (!c) return null;
  const stops = [
    stopsLabel(c.stopsOut),
    c.stopsBack !== c.stopsOut ? `back ${stopsLabel(c.stopsBack).toLowerCase()}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return <div className="text-xs text-muted">{[c.airline, stops].filter(Boolean).join(' · ')}</div>;
}

function BookingOptions({ itineraryId }: { itineraryId: string }) {
  const [links, setLinks] = useState<BookingLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!links && !error) {
    return (
      <button
        type="button"
        className="btn btn-sm"
        disabled={loading}
        onClick={() => {
          setLoading(true);
          api
            .bookingLinks(itineraryId)
            .then(setLinks)
            .catch((e: Error) => setError(e.message))
            .finally(() => setLoading(false));
        }}
      >
        {loading ? 'Loading…' : 'Where to book'}
      </button>
    );
  }
  if (error) return <span className="text-xs text-muted">{error}</span>;
  if (!links?.length) return <span className="text-xs text-muted">No direct booking links. Try Google Flights.</span>;
  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {links.slice(0, 5).map((l) => (
        <li key={l.url}>
          <a className="text-accent underline" href={l.url} target="_blank" rel="noreferrer">
            {l.providerName}
          </a>
          {l.price !== null && l.currency && (
            <span className="tabular text-ink-2"> {formatPrice(l.price, l.currency)}</span>
          )}
          {l.providerType === 'airline' && <span className="text-muted"> (airline)</span>}
        </li>
      ))}
    </ul>
  );
}

const ROW_GRID = 'grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 md:grid-cols-[6.5rem_10rem_12rem_1fr_auto]';

export function QuoteRow({ quote, actions }: { quote: Quote; actions: QuoteActions }) {
  const [checking, setChecking] = useState(false);
  return (
    <li className={`${ROW_GRID} border-t border-hairline py-2.5 text-sm`}>
      <div className="row-span-2 md:row-span-1">
        <div className="tabular text-lg font-semibold">{formatPrice(quote.price, quote.currency)}</div>
        <SourceBadge quote={quote} />
      </div>
      <div>
        <div className="font-medium">
          {quote.origin} → {quote.destination}
        </div>
        <div className="text-xs text-muted">
          {actions.airportName(quote.origin)} → {actions.airportName(quote.destination)}
        </div>
      </div>
      <div>
        <div className="whitespace-nowrap">
          {formatDate(quote.departDate)} → {formatDate(quote.returnDate)}
        </div>
        <div className="text-xs text-muted">{quote.days} days</div>
      </div>
      <div className="col-span-2 md:col-span-1">
        <FlightInfo quote={quote} />
      </div>
      <div className="col-span-2 flex flex-wrap items-start gap-1.5 md:col-span-1 md:justify-end">
        {quote.source === 'cached' && actions.checkLive && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={checking}
            onClick={() => {
              setChecking(true);
              actions.checkLive!(quote).finally(() => setChecking(false));
            }}
          >
            {checking ? 'Checking…' : 'Check live'}
          </button>
        )}
        {quote.itinerary && actions.canBook && <BookingOptions itineraryId={quote.itinerary.ignavId} />}
        <a className="btn btn-sm" href={googleFlightsUrl(quote)} target="_blank" rel="noreferrer">
          Google Flights
        </a>
        <a className="btn btn-sm" href={skyscannerUrl(quote)} target="_blank" rel="noreferrer">
          Skyscanner
        </a>
      </div>
    </li>
  );
}

interface ListProps {
  quotes: Quote[];
  actions: QuoteActions;
  label: string;
  /** Rows shown before "Show all". */
  initialRows?: number;
}

export function QuoteList({ quotes, actions, label, initialRows = Infinity }: ListProps) {
  const [expanded, setExpanded] = useState(false);
  if (quotes.length === 0) return <p className="text-sm text-muted">No prices found.</p>;
  const visible = expanded ? quotes : quotes.slice(0, initialRows);
  return (
    <div>
      <div className={`${ROW_GRID} hidden pb-1 text-xs text-muted md:grid`} aria-hidden>
        <span>Price</span>
        <span>Route</span>
        <span>Dates</span>
        <span>Flights</span>
      </div>
      <ul aria-label={label}>
        {visible.map((q) => (
          <QuoteRow key={`${q.origin}${q.destination}${q.departDate}${q.returnDate}`} quote={q} actions={actions} />
        ))}
      </ul>
      {visible.length < quotes.length && (
        <button type="button" className="btn btn-sm mt-2" onClick={() => setExpanded(true)}>
          Show all {quotes.length}
        </button>
      )}
    </div>
  );
}
