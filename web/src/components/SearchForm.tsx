import { useEffect, useMemo, useState } from 'react';
import { generatePairs } from '../../../shared/dates';
import type { DateOptions, ResolvedAirport, SearchFilters, SearchRequest } from '../../../shared/types';
import { api, type AppConfig } from '../api';
import { DateOptionsField, defaultFlexible } from './DateOptionsField';
import { isSelected, LocationField, type LocationValue } from './LocationField';

interface FormState {
  from: LocationValue;
  to: LocationValue;
  dates: DateOptions;
  filters: SearchFilters;
  liveBudget: number;
}

const STORAGE_KEY = 'flightscanner.form.v2';
const LEGACY_STORAGE_KEY = 'flightscanner.form.v1';

function defaultState(liveBudget: number): FormState {
  return {
    from: {
      specs: [{ kind: 'near', lat: 51.5555, lon: 5.0913, radiusKm: 150, label: 'Tilburg' }],
      overrides: {},
    },
    to: { specs: [{ kind: 'country', code: 'CO', label: 'Colombia' }], overrides: {} },
    dates: defaultFlexible(),
    filters: { adults: 1, maxStops: null, minCheckedBags: 0, allowSelfTransfer: true },
    liveBudget,
  };
}

function loadState(liveBudget: number): FormState {
  try {
    let saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as FormState | null;
    if (!saved) {
      // v1 defaulted to no self-transfer, which hides every fare from small regional airports.
      const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? 'null') as FormState | null;
      if (legacy?.filters) saved = { ...legacy, filters: { ...legacy.filters, allowSelfTransfer: true } };
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    if (saved?.from && saved.to && saved.dates && saved.filters) {
      // Don't bring back a period that is already over.
      const today = new Date().toISOString().slice(0, 10);
      const stale = saved.dates.mode === 'flexible' ? saved.dates.windowEnd < today : saved.dates.departDate < today;
      return { ...saved, dates: stale ? defaultFlexible() : saved.dates };
    }
  } catch {
    // ignore broken saved state
  }
  return defaultState(liveBudget);
}

function useResolved(value: LocationValue) {
  const [airports, setAirports] = useState<ResolvedAirport[]>([]);
  const key = JSON.stringify(value.specs);
  useEffect(() => {
    let cancelled = false;
    if (value.specs.length === 0) {
      setAirports([]);
      return;
    }
    api
      .resolve(value.specs)
      .then((a) => !cancelled && setAirports(a))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);
  return airports;
}

interface Props {
  config: AppConfig;
  running: boolean;
  onSearch: (req: SearchRequest, airports: ResolvedAirport[]) => void;
}

export function SearchForm({ config, running, onSearch }: Props) {
  const [state, setState] = useState<FormState>(() => loadState(config.defaultLiveBudget));
  const [showOptions, setShowOptions] = useState(false);
  const fromAirports = useResolved(state.from);
  const toAirports = useResolved(state.to);

  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)), [state]);

  const origins = fromAirports.filter((a) => isSelected(a, state.from.overrides)).map((a) => a.code);
  const destinations = toAirports.filter((a) => isSelected(a, state.to.overrides)).map((a) => a.code);
  const routes = origins.length * destinations.length - origins.filter((o) => destinations.includes(o)).length;
  const pairCount = useMemo(() => generatePairs(state.dates).length, [state.dates]);
  const set = (patch: Partial<FormState>) => setState((s) => ({ ...s, ...patch }));
  const setFilters = (patch: Partial<SearchFilters>) =>
    setState((s) => ({ ...s, filters: { ...s.filters, ...patch } }));
  const hasLive = config.providers.live !== 'none';
  const canSearch = routes > 0 && pairCount > 0 && !running;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSearch) return;
    onSearch(
      { origins, destinations, dates: state.dates, filters: state.filters, liveBudget: hasLive ? state.liveBudget : 0 },
      [...fromAirports, ...toAirports],
    );
  };

  return (
    <form onSubmit={submit} className="card flex flex-col gap-5 p-4 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-start">
        <LocationField
          label="From"
          placeholder="Airport, city (e.g. Tilburg) or country"
          value={state.from}
          airports={fromAirports}
          onChange={(from) => set({ from })}
        />
        <button
          type="button"
          className="btn self-center lg:mt-7"
          aria-label="Swap from and to"
          title="Swap from and to"
          onClick={() => set({ from: state.to, to: state.from })}
        >
          ⇄
        </button>
        <LocationField
          label="To"
          placeholder="Airport, city or country (e.g. Colombia)"
          value={state.to}
          airports={toAirports}
          onChange={(to) => set({ to })}
        />
      </div>

      <DateOptionsField value={state.dates} onChange={(dates) => set({ dates })} />

      <div>
        <button
          type="button"
          className="text-sm text-accent"
          aria-expanded={showOptions}
          onClick={() => setShowOptions((v) => !v)}
        >
          {showOptions ? '▾' : '▸'} Passengers, stops, bags and live checks
        </button>
        {showOptions && (
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Adults
              <select
                className="field"
                value={state.filters.adults}
                onChange={(e) => setFilters({ adults: Number(e.target.value) })}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Stops
              <select
                className="field"
                value={state.filters.maxStops ?? 'any'}
                onChange={(e) => setFilters({ maxStops: e.target.value === 'any' ? null : Number(e.target.value) })}
              >
                <option value="any">Any</option>
                <option value={0}>Direct only</option>
                <option value={1}>Max 1 stop</option>
                <option value={2}>Max 2 stops</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Checked bags (min.)
              <select
                className="field"
                value={state.filters.minCheckedBags}
                onChange={(e) => setFilters({ minCheckedBags: Number(e.target.value) })}
              >
                <option value={0}>No preference</option>
                <option value={1}>1 bag included</option>
                <option value={2}>2 bags included</option>
              </select>
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-ink-2">
              <input
                type="checkbox"
                checked={state.filters.allowSelfTransfer}
                onChange={(e) => setFilters({ allowSelfTransfer: e.target.checked })}
              />
              Allow separate tickets (self-transfer)
            </label>
            {hasLive && (
              <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">
                Live price checks per search: {state.liveBudget}
                <input
                  type="range"
                  min={0}
                  max={config.maxLiveBudget}
                  step={5}
                  value={state.liveBudget}
                  onChange={(e) => set({ liveBudget: Number(e.target.value) })}
                />
                <span>
                  More checks find more real prices. Ignav: first 1,000 free, then $0.002 per check. This app used{' '}
                  {config.ignavRequestsUsed}.
                </span>
              </label>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary px-5 py-2" disabled={!canSearch}>
          {running ? 'Searching…' : 'Search flights'}
        </button>
        <span className="text-sm text-muted">
          {routes} route{routes === 1 ? '' : 's'} × {pairCount} date combination{pairCount === 1 ? '' : 's'}
          {hasLive && ` · up to ${Math.min(state.liveBudget, routes * pairCount)} live checks`}
        </span>
      </div>
    </form>
  );
}
