import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResolvedAirport, SearchJob, SearchRequest } from '../../shared/types';
import { api, type AppConfig } from './api';
import { Results } from './components/Results';
import { SearchForm } from './components/SearchForm';

const POLL_MS = 800;

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [job, setJob] = useState<SearchJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const pollRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch((e: Error) => setConfigError(e.message));
  }, []);

  const refresh = useCallback(async (id: string) => {
    const next = await api.getSearch(id);
    setJob(next);
    return next;
  }, []);

  const poll = useCallback(
    (id: string) => {
      clearTimeout(pollRef.current);
      pollRef.current = setTimeout(async () => {
        try {
          const next = await refresh(id);
          if (next.status === 'running') poll(id);
          else api.config().then(setConfig, () => {});
        } catch (e) {
          setError((e as Error).message);
        }
      }, POLL_MS);
    },
    [refresh],
  );

  useEffect(() => () => clearTimeout(pollRef.current), []);

  const onSearch = async (req: SearchRequest, airports: ResolvedAirport[]) => {
    setError(null);
    setNames((n) => ({ ...n, ...Object.fromEntries(airports.map((a) => [a.code, a.city || a.name])) }));
    try {
      const started = await api.startSearch(req);
      setJob(started);
      poll(started.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const airportName = (code: string) => names[code] ?? '';

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-3 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">✈ Flightscanner</h1>
        {config && (
          <span className="text-xs text-muted">
            Cached prices: {config.providers.cached} · Live prices: {config.providers.live} ·{' '}
            {config.version === '0.0.0' ? 'dev build' : `v${config.version}`}
          </span>
        )}
      </header>

      {configError && <div className="card p-4 text-sm">Cannot reach the server: {configError}</div>}

      {config?.demo && (
        <div className="card border-l-4 p-3 text-sm" style={{ borderLeftColor: '#fab219' }}>
          <strong>Demo mode:</strong> prices are fake. Add <code>IGNAV_API_KEY</code> and{' '}
          <code>TRAVELPAYOUTS_TOKEN</code> to use real prices (see README).
        </div>
      )}

      {config && <SearchForm config={config} running={job?.status === 'running'} onSearch={onSearch} />}
      {error && <div className="card p-4 text-sm">{error}</div>}
      {job && <Results job={job} airportName={airportName} onJobUpdate={() => refresh(job.id).then(() => {})} />}
    </div>
  );
}
