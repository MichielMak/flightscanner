import type { Quote } from '../../shared/types';

const priceFormats = new Map<string, Intl.NumberFormat>();

export function formatPrice(amount: number, currency: string): string {
  let f = priceFormats.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('en-IE', { style: 'currency', currency, maximumFractionDigits: 0 });
    priceFormats.set(currency, f);
  }
  return f.format(amount);
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const formatDate = (iso: string) => dateFormat.format(new Date(`${iso}T00:00:00Z`));
export const formatShortDate = (iso: string) => shortDate.format(new Date(`${iso}T00:00:00Z`));
export const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '';
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
}

export const formatTime = (localIso: string) => localIso.slice(11, 16);

export function stopsLabel(stops: number | null | undefined, via: string[] = []): string {
  if (stops === null || stops === undefined) return '';
  if (stops === 0) return 'Direct';
  return `${stops} stop${stops > 1 ? 's' : ''}${via.length ? ` via ${via.join(', ')}` : ''}`;
}

/** Free deep links, so any result can be double-checked (and booked) without spending API calls. */
export function googleFlightsUrl(q: Pick<Quote, 'origin' | 'destination' | 'departDate' | 'returnDate'>): string {
  const text = `Flights to ${q.destination} from ${q.origin} on ${q.departDate} through ${q.returnDate}`;
  return `https://www.google.com/travel/flights?${new URLSearchParams({ q: text, curr: 'EUR', hl: 'en' })}`;
}

export function skyscannerUrl(q: Pick<Quote, 'origin' | 'destination' | 'departDate' | 'returnDate'>): string {
  const d = (iso: string) => iso.slice(2).replaceAll('-', '');
  return `https://www.skyscanner.nl/transport/vluchten/${q.origin.toLowerCase()}/${q.destination.toLowerCase()}/${d(q.departDate)}/${d(q.returnDate)}/`;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
