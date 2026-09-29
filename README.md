# Flightscanner

Compare round-trip flight prices from **all airports near you** to **all airports in a region**, and find the
**cheapest dates in a month** for a trip of roughly N days.

Built for flying between Tilburg (Eindhoven, Amsterdam, Brussels, Düsseldorf, …) and Colombia, but works for any route.

- **From / To**: type an airport (`AMS`), a place (`Tilburg`, then pick a radius) or a country (`Colombia`).
  Big airports are switched on automatically; click any airport to switch it on or off.
- **Specific dates**: depart + return date, optionally ± 1–3 days.
- **Flexible**: a month (or any period up to 3 months) plus a trip length with a margin, e.g. _12 days ± 2_
  (= 1.5 to 2 weeks). The app looks for the cheapest combination.
- **Results**: best price, a table comparing every airport pair, a price calendar (departure date × trip length),
  and a list of the best options with links to Google Flights, Skyscanner and booking sites.

## How the search works

Checking every combination live is too slow and too expensive. December with trips of 10–14 days is 155 date
combinations; with 8 home airports and 6 Colombian airports that is 7,440 searches. So the search runs in two steps:

1. **Month scan (free, cached).** [Travelpayouts](https://www.travelpayouts.com) (Aviasales data) returns prices that
   other travellers found in the last days, for a whole month per route in one request. That gives a rough map of
   where the cheap dates are. These prices can be a few days old and don't cover every date.
2. **Live check (paid, accurate).** [Ignav](https://ignav.com) returns real, bookable prices. The app spends a fixed
   budget of live checks (default 25 per search) on the most promising options:
   - the cheapest cached date for every route, so every airport gets a fair comparison;
   - one sample date for routes the cache knows nothing about;
   - the rest on the next-cheapest cached options.

Live prices replace cached ones. Each result is labelled **Live** or **Cached**, and any cached result can be checked
live with one click. Results are cached in memory for a few hours, so repeating a search costs nothing.

**Costs:** Travelpayouts is free. Ignav gives 1,000 free requests once, then $2 per 1,000 ($0.05 for a 25-check
search). The form shows how many Ignav requests the app has used.

Without API keys the app runs in **demo mode** with fake prices, so you can try it right away.

## Get the API keys (10 minutes)

1. **Ignav** (live prices): sign up at <https://ignav.com/signup>, verify your email, copy the API key from the
   [dashboard](https://ignav.com/dashboard).
2. **Travelpayouts** (month scan): sign up at <https://www.travelpayouts.com>, join the Aviasales program, copy the
   token from <https://www.travelpayouts.com/programs/100/tools/api>.
3. Copy `.env.example` to `.env` and paste both keys.

Either key alone also works. With only Travelpayouts you get cached prices only; with only Ignav the live checks are
spread evenly over the dates.

## Run on TrueNAS (Docker)

Every merge to `main` publishes an image to `ghcr.io/michielmak/flightscanner:latest` (see
`.github/workflows/ci.yml`).

In the TrueNAS UI: **Apps → Discover Apps → Custom App**

1. Image: `ghcr.io/michielmak/flightscanner`, tag `latest`
2. Environment variables: `IGNAV_API_KEY` and `TRAVELPAYOUTS_TOKEN`
3. Port: container `8080` to any free host port
4. Storage: a host path (e.g. `/mnt/<pool>/apps/flightscanner`) mounted at `/data`. It only holds the Ignav usage
   counter. The container runs as user `node` (uid 1000), so give that uid write access.

Or build it yourself with Docker Compose:

```sh
git clone https://github.com/MichielMak/flightscanner.git && cd flightscanner
cp .env.example .env   # add your keys
docker compose up -d --build
```

Then open `http://<truenas-ip>:8080`.

## Run locally

Needs Node.js 22+.

```sh
npm install
npm run dev      # web on http://localhost:5173, API on :8080
npm test
npm run build && npm start   # production build on :8080
```

Optional: run the same hooks as CI (gitleaks, actionlint, YAML/JSON checks) before each commit with [pre-commit](https://pre-commit.com): `pre-commit install`.

## Checks

- **CI**: typecheck, Prettier, tests, build and Docker build.
- **Pre-commit**: the hooks in `.pre-commit-config.yaml`.
- **Trivy** (PRs): fails on fixable HIGH/CRITICAL issues in `package-lock.json`, the Dockerfile, committed secrets and the built image.
- **Trivy weekly**: scans `main` and the latest released image, and opens a `security` issue when it finds something.
- **Renovate**: runs from [docker-stacks](https://github.com/MichielMak/docker-stacks) with `renovate.json` from this repo. Non-major npm and GitHub Actions updates automerge when checks pass.

## Configuration

| Variable               | Default  | What it does                                            |
| ---------------------- | -------- | ------------------------------------------------------- |
| `IGNAV_API_KEY`        |          | Live prices                                             |
| `TRAVELPAYOUTS_TOKEN`  |          | Cached month scan                                       |
| `IGNAV_MARKET`         | `NL`     | Country for pricing; `NL` gives euros                   |
| `TRAVELPAYOUTS_MARKET` |          | Aviasales market, e.g. `nl`                             |
| `DEFAULT_LIVE_BUDGET`  | `25`     | Live checks per search (the form lets you change it)    |
| `MAX_LIVE_BUDGET`      | `150`    | Upper limit for live checks per search                  |
| `DEMO_MODE`            | `false`  | Fake prices, also on automatically when no keys are set |
| `PORT`                 | `8080`   | HTTP port                                               |
| `DATA_DIR`             | `./data` | Where the usage counter is stored                       |

## Project layout

```
server/            Hono API: airport lookup, search engine, providers
  providers/       ignav.ts (live), travelpayouts.ts (cached), demo.ts (fake)
  search.ts        Two-step search and the live-check selection
  data/            Airports from OurAirports (public domain), rebuilt with `npm run airports`
shared/            Types and date logic used by both server and web
web/               React + Tailwind front end
```

Place search uses OpenStreetMap [Nominatim](https://nominatim.org) (max 1 request per second, cached).
