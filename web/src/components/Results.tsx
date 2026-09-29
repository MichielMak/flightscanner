import { useEffect, useState } from 'react';
import type { Quote, SearchJob } from '../../../shared/types';
import { api } from '../api';
import { formatDate, formatPrice } from '../format';
import { PriceCalendar } from './PriceCalendar';
import { QuoteList, SourceBadge, type QuoteActions } from './QuoteList';
import { RouteMatrix } from './RouteMatrix';

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card flex flex-col gap-3 p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Progress({ job }: { job: SearchJob }) {
  const pct = job.progress.total ? Math.round((job.progress.done / job.progress.total) * 100) : 0;
  return (
    <div className="card flex flex-col gap-2 p-4" aria-live="polite">
      <div className="flex justify-between text-sm">
        <span>{job.phase}…</span>
        <span className="tabular text-muted">
          {job.progress.done} / {job.progress.total}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--empty-cell)' }}>
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Hero({ quote, adults, airportName }: { quote: Quote; adults: number; airportName: (c: string) => string }) {
  return (
    <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 sm:p-5">
      <div>
        <div className="text-xs text-muted">Best price found{adults > 1 && `, total for ${adults} adults`}</div>
        <div className="text-3xl font-semibold">{formatPrice(quote.price, quote.currency)}</div>
      </div>
      <div className="text-sm">
        <div className="font-medium">
          {quote.origin} {airportName(quote.origin)} → {quote.destination} {airportName(quote.destination)}
        </div>
        <div className="text-ink-2">
          {formatDate(quote.departDate)} → {formatDate(quote.returnDate)} · {quote.days} days
        </div>
      </div>
      <SourceBadge quote={quote} />
    </div>
  );
}

interface Props {
  job: SearchJob;
  airportName: (code: string) => string;
  onJobUpdate: () => Promise<void>;
}

export function Results({ job, airportName, onJobUpdate }: Props) {
  const [selected, setSelected] = useState<{ dep: string; ret: string } | null>(null);
  const [pairQuotes, setPairQuotes] = useState<Quote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { results } = job;
  const hasLive = job.providers.live !== 'none';

  const loadPair = (dep: string, ret: string) =>
    api
      .quotesForDates(job.id, dep, ret)
      .then(setPairQuotes)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    setSelected(null);
    setPairQuotes([]);
  }, [job.id]);

  const actions: QuoteActions = {
    airportName,
    canBook: job.providers.live === 'ignav',
    checkLive: hasLive
      ? async (q) => {
          setError(null);
          try {
            await api.checkLive(job.id, q);
            await onJobUpdate();
            if (selected) await loadPair(selected.dep, selected.ret);
          } catch (e) {
            setError((e as Error).message);
          }
        }
      : null,
  };

  const showCalendar = results.byDates.length > 1;

  return (
    <div className="flex flex-col gap-4">
      {job.status === 'running' && <Progress job={job} />}
      {job.status === 'error' && <div className="card p-4 text-sm">Search failed: {job.error}</div>}
      {error && <div className="card p-4 text-sm">{error}</div>}
      {job.warnings.length > 0 && (
        <ul className="card flex flex-col gap-1 p-4 text-sm text-ink-2">
          {job.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {results.top[0] && <Hero quote={results.top[0]} adults={job.request.filters.adults} airportName={airportName} />}

      {results.total > 0 && (
        <>
          <Section title="Airports compared" subtitle="Cheapest price per route over all your dates.">
            <RouteMatrix
              origins={job.request.origins}
              destinations={job.request.destinations}
              byRoute={results.byRoute}
              airportName={airportName}
            />
          </Section>

          {showCalendar && (
            <Section title="Price calendar" subtitle="Which dates are cheapest? The boldest squares are the cheapest.">
              <PriceCalendar
                byDates={results.byDates}
                selected={selected}
                airportName={airportName}
                onSelect={(dep, ret) => {
                  setSelected({ dep, ret });
                  void loadPair(dep, ret);
                }}
              />
              {selected && (
                <div className="border-t border-hairline pt-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">
                      All airports for {formatDate(selected.dep)} → {formatDate(selected.ret)}
                    </h3>
                    <button
                      type="button"
                      className="text-sm text-muted hover:text-ink"
                      onClick={() => setSelected(null)}
                    >
                      Close
                    </button>
                  </div>
                  <QuoteList
                    quotes={pairQuotes.filter((q) => !q.liveNoResult)}
                    actions={actions}
                    label="All routes for the selected dates"
                  />
                </div>
              )}
            </Section>
          )}

          <Section
            title="Best options"
            subtitle={`Top ${results.top.length} of ${results.total} prices found${job.request.filters.adults > 1 ? ` (totals for ${job.request.filters.adults} adults)` : ''}. Cached prices can be days old: check them live or on Google Flights before booking.`}
          >
            <QuoteList quotes={results.top} actions={actions} label="Cheapest options" initialRows={10} />
          </Section>
        </>
      )}

      {job.status === 'done' && results.total === 0 && (
        <div className="card p-4 text-sm">No prices found. Try more airports, a longer period, or fewer filters.</div>
      )}

      {job.status !== 'running' && (
        <p className="text-xs text-muted">
          Used {job.cachedRequestsUsed} cached lookups and {job.liveRequestsUsed} live checks.
        </p>
      )}
    </div>
  );
}
