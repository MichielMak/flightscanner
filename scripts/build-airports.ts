/**
 * Builds server/data/airports.json from OurAirports (public domain).
 * Keeps only large/medium airports with scheduled service and an IATA code.
 *
 *   npm run airports
 */
import { writeFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

const BASE = 'https://davidmegginson.github.io/ourairports-data';

async function fetchCsv(file: string): Promise<Record<string, string>[]> {
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`Failed to download ${file}: ${res.status}`);
  return parse(await res.text(), { columns: true, skip_empty_lines: true });
}

const countries = new Map((await fetchCsv('countries.csv')).map((c) => [c.code, c.name]));
const airports = (await fetchCsv('airports.csv'))
  .filter(
    (a) =>
      (a.type === 'large_airport' || a.type === 'medium_airport') &&
      a.scheduled_service === 'yes' &&
      /^[A-Z]{3}$/.test(a.iata_code),
  )
  .map((a) => ({
    code: a.iata_code,
    name: a.name,
    city: a.municipality || '',
    country: a.iso_country,
    countryName: countries.get(a.iso_country) ?? a.iso_country,
    lat: Math.round(Number(a.latitude_deg) * 1e4) / 1e4,
    lon: Math.round(Number(a.longitude_deg) * 1e4) / 1e4,
    size: a.type === 'large_airport' ? 'large' : 'medium',
  }))
  .sort((a, b) => a.code.localeCompare(b.code));

writeFileSync(new URL('../server/data/airports.json', import.meta.url), JSON.stringify(airports));
console.log(`Wrote ${airports.length} airports`);
