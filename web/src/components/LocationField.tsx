import { useEffect, useId, useRef, useState } from 'react';
import type { LocationSpec, LocationSuggestions, ResolvedAirport } from '../../../shared/types';
import { api } from '../api';

export interface LocationValue {
  specs: LocationSpec[];
  /** Airports the user switched on/off by hand. Everything else follows `suggested`. */
  overrides: Record<string, boolean>;
}

export const isSelected = (a: ResolvedAirport, overrides: Record<string, boolean>) => overrides[a.code] ?? a.suggested;

const RADIUS_OPTIONS = [50, 100, 150, 200, 300];

interface Props {
  label: string;
  placeholder: string;
  value: LocationValue;
  airports: ResolvedAirport[];
  onChange: (value: LocationValue) => void;
}

type Option = { key: string; title: string; detail: string; spec: LocationSpec };

function toOptions(s: LocationSuggestions): Option[] {
  return [
    ...s.airports.map((a) => ({
      key: `a${a.code}`,
      title: `${a.code} · ${a.name}`,
      detail: [a.city, a.countryName].filter(Boolean).join(', '),
      spec: { kind: 'airport', code: a.code, label: `${a.code} ${a.city || a.name}` } as const,
    })),
    ...s.countries.map((c) => ({
      key: `c${c.code}`,
      title: `All of ${c.name}`,
      detail: `${c.airportCount} airports, major ones pre-selected`,
      spec: { kind: 'country', code: c.code, label: c.name } as const,
    })),
    ...s.places.map((p, i) => {
      const short = p.label.split(',')[0];
      return {
        key: `p${i}`,
        title: `Airports near ${short}`,
        detail: p.label,
        spec: { kind: 'near', lat: p.lat, lon: p.lon, radiusKm: 150, label: short } as const,
      };
    }),
  ];
}

export function LocationField({ label, placeholder, value, airports, onChange }: Props) {
  const [text, setText] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) {
      setOptions([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      api
        .suggest(q, ctrl.signal)
        .then((s) => {
          setOptions(toOptions(s));
          setActive(0);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [text]);

  const pick = (o: Option) => {
    onChange({ ...value, specs: [...value.specs, o.spec] });
    setText('');
    setOptions([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const removeSpec = (i: number) => onChange({ ...value, specs: value.specs.filter((_, j) => j !== i) });

  const setRadius = (i: number, radiusKm: number) =>
    onChange({
      ...value,
      specs: value.specs.map((s, j) => (j === i && s.kind === 'near' ? { ...s, radiusKm } : s)),
    });

  const toggle = (a: ResolvedAirport) =>
    onChange({ ...value, overrides: { ...value.overrides, [a.code]: !isSelected(a, value.overrides) } });

  const selectedCount = airports.filter((a) => isSelected(a, value.overrides)).length;

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-ink-2" htmlFor={`${listId}-input`}>
        {label}
      </label>

      <div className="relative">
        <div className="field flex flex-wrap items-center gap-1.5">
          {value.specs.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-md bg-page px-2 py-0.5 text-sm">
              {s.kind === 'near' ? (
                <>
                  Near {s.label}
                  <select
                    aria-label={`Radius around ${s.label}`}
                    className="bg-transparent text-sm"
                    value={s.radiusKm}
                    onChange={(e) => setRadius(i, Number(e.target.value))}
                  >
                    {[...new Set([...RADIUS_OPTIONS, s.radiusKm])]
                      .sort((a, b) => a - b)
                      .map((r) => (
                        <option key={r} value={r}>
                          {r} km
                        </option>
                      ))}
                  </select>
                </>
              ) : (
                s.label
              )}
              <button
                type="button"
                aria-label={`Remove ${s.label}`}
                className="px-1 text-muted hover:text-ink"
                onClick={() => removeSpec(i)}
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            id={`${listId}-input`}
            className="min-w-40 flex-1 bg-transparent py-0.5 outline-none"
            placeholder={value.specs.length ? 'Add more…' : placeholder}
            value={text}
            role="combobox"
            aria-expanded={open && options.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, options.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter' && options[active]) {
                e.preventDefault();
                pick(options[active]);
              } else if (e.key === 'Escape') {
                setOpen(false);
              } else if (e.key === 'Backspace' && !text && value.specs.length) {
                removeSpec(value.specs.length - 1);
              }
            }}
          />
          {loading && <span className="text-xs text-muted">searching…</span>}
        </div>

        {open && options.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="card absolute z-20 mt-1 max-h-80 w-full overflow-auto py-1 shadow-lg"
          >
            {options.map((o, i) => (
              <li
                key={o.key}
                role="option"
                aria-selected={i === active}
                className={`cursor-pointer px-3 py-1.5 ${i === active ? 'bg-page' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
              >
                <div className="text-sm">{o.title}</div>
                <div className="truncate text-xs text-muted">{o.detail}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {airports.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-muted">
            {selectedCount} of {airports.length} airports selected. Click to switch on or off.
          </div>
          <div className="flex flex-wrap gap-1.5">
            {airports.map((a) => {
              const on = isSelected(a, value.overrides);
              return (
                <button
                  key={a.code}
                  type="button"
                  aria-pressed={on}
                  title={`${a.name}, ${a.city} (${a.countryName})`}
                  onClick={() => toggle(a)}
                  className={`rounded-md border px-2 py-0.5 text-sm ${
                    on ? 'border-accent bg-accent text-white' : 'border-hairline text-ink-2 hover:border-accent'
                  }`}
                >
                  <span className="font-semibold">{a.code}</span> <span className="opacity-80">{a.city || a.name}</span>
                  {a.distanceKm !== undefined && <span className="tabular opacity-70"> · {a.distanceKm} km</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
