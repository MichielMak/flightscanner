import type { DateOptions } from '../../../shared/types';
import { addDays, formatShortDate, todayIso } from '../format';

type Flexible = Extract<DateOptions, { mode: 'flexible' }>;
type Exact = Extract<DateOptions, { mode: 'exact' }>;

const TRIP_PRESETS = [
  { label: '1 week', tripDays: 7, marginDays: 1 },
  { label: '1.5 – 2 weeks', tripDays: 12, marginDays: 2 },
  { label: '2 weeks', tripDays: 14, marginDays: 1 },
  { label: '3 weeks', tripDays: 21, marginDays: 2 },
];

function monthRange(ym: string): { windowStart: string; windowEnd: string } {
  const [y, m] = ym.split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { windowStart: `${ym}-01`, windowEnd: end };
}

function upcomingMonths(count = 13): { value: string; label: string }[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    return {
      value: d.toISOString().slice(0, 7),
      label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    };
  });
}

export function defaultFlexible(): Flexible {
  const next = upcomingMonths(2)[1].value;
  return { mode: 'flexible', ...monthRange(next), tripDays: 12, marginDays: 2, returnWithinWindow: false };
}

export function defaultExact(): Exact {
  const dep = addDays(todayIso(), 30);
  return { mode: 'exact', departDate: dep, returnDate: addDays(dep, 14), flexDays: 0 };
}

interface Props {
  value: DateOptions;
  onChange: (v: DateOptions) => void;
}

export function DateOptionsField({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-ink-2">When</span>
        <div className="seg" role="group" aria-label="Date mode">
          <button
            type="button"
            aria-pressed={value.mode === 'flexible'}
            onClick={() => value.mode !== 'flexible' && onChange(defaultFlexible())}
          >
            Flexible: best dates in a period
          </button>
          <button
            type="button"
            aria-pressed={value.mode === 'exact'}
            onClick={() => value.mode !== 'exact' && onChange(defaultExact())}
          >
            Specific dates
          </button>
        </div>
      </div>
      {value.mode === 'flexible' ? (
        <FlexibleFields value={value} onChange={onChange} />
      ) : (
        <ExactFields value={value} onChange={onChange} />
      )}
    </div>
  );
}

function FlexibleFields({ value, onChange }: { value: Flexible; onChange: (v: Flexible) => void }) {
  const months = upcomingMonths();
  const month = value.windowStart.slice(0, 7);
  const isWholeMonth =
    monthRange(month).windowStart === value.windowStart && monthRange(month).windowEnd === value.windowEnd;
  const set = (patch: Partial<Flexible>) => onChange({ ...value, ...patch });
  const shortest = Math.max(1, value.tripDays - value.marginDays);
  const longest = value.tripDays + value.marginDays;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted" htmlFor="period">
          Leave some time in
        </label>
        <select
          id="period"
          className="field"
          value={isWholeMonth ? month : 'custom'}
          onChange={(e) => (e.target.value === 'custom' ? set({}) : set(monthRange(e.target.value)))}
        >
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
          {!isWholeMonth && <option value="custom">Custom period</option>}
        </select>
        <div className="flex items-center gap-2 text-sm">
          <input
            type="date"
            aria-label="Period start"
            className="field py-1"
            value={value.windowStart}
            min={todayIso()}
            onChange={(e) => e.target.value && set({ windowStart: e.target.value })}
          />
          <span className="text-muted">to</span>
          <input
            type="date"
            aria-label="Period end"
            className="field py-1"
            value={value.windowEnd}
            min={value.windowStart}
            onChange={(e) => e.target.value && set({ windowEnd: e.target.value })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={value.returnWithinWindow}
            onChange={(e) => set({ returnWithinWindow: e.target.checked })}
          />
          Also return within this period
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">Trip length</span>
        <div className="flex flex-wrap gap-1.5">
          {TRIP_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={p.tripDays === value.tripDays && p.marginDays === value.marginDays}
              className={`rounded-md border px-2 py-0.5 text-sm ${
                p.tripDays === value.tripDays && p.marginDays === value.marginDays
                  ? 'border-accent bg-accent text-white'
                  : 'border-hairline text-ink-2 hover:border-accent'
              }`}
              onClick={() => set({ tripDays: p.tripDays, marginDays: p.marginDays })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input
            type="number"
            aria-label="Trip length in days"
            className="field w-20 py-1"
            min={1}
            max={90}
            value={value.tripDays}
            onChange={(e) => set({ tripDays: Math.max(1, Math.min(90, Number(e.target.value) || 1)) })}
          />
          <span>days ±</span>
          <input
            type="number"
            aria-label="Margin in days"
            className="field w-16 py-1"
            min={0}
            max={14}
            value={value.marginDays}
            onChange={(e) => set({ marginDays: Math.max(0, Math.min(14, Number(e.target.value) || 0)) })}
          />
          <span>days</span>
        </div>
        <div className="text-xs text-muted">
          Trips of {shortest}–{longest} days, leaving between {formatShortDate(value.windowStart)} and{' '}
          {formatShortDate(value.windowEnd)}.
        </div>
      </div>
    </div>
  );
}

function ExactFields({ value, onChange }: { value: Exact; onChange: (v: Exact) => void }) {
  const set = (patch: Partial<Exact>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-muted">
        Depart
        <input
          type="date"
          className="field"
          value={value.departDate}
          min={todayIso()}
          onChange={(e) => {
            if (!e.target.value) return;
            const departDate = e.target.value;
            set({ departDate, returnDate: value.returnDate < departDate ? departDate : value.returnDate });
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Return
        <input
          type="date"
          className="field"
          value={value.returnDate}
          min={value.departDate}
          onChange={(e) => e.target.value && set({ returnDate: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Flexibility
        <select className="field" value={value.flexDays} onChange={(e) => set({ flexDays: Number(e.target.value) })}>
          <option value={0}>Exact dates</option>
          <option value={1}>± 1 day</option>
          <option value={2}>± 2 days</option>
          <option value={3}>± 3 days</option>
        </select>
      </label>
    </div>
  );
}
