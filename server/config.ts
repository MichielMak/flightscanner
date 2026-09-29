import pkg from '../package.json' with { type: 'json' };

const env = (name: string) => process.env[name]?.trim() || null;

const ignavKey = env('IGNAV_API_KEY');
const travelpayoutsToken = env('TRAVELPAYOUTS_TOKEN');

export const config = {
  /** Set by the release PR; 0.0.0 means an unreleased development build. */
  version: pkg.version,
  port: Number(env('PORT') ?? 8080),
  ignavKey,
  ignavMarket: env('IGNAV_MARKET') ?? 'NL',
  travelpayoutsToken,
  travelpayoutsMarket: env('TRAVELPAYOUTS_MARKET'),
  /** Fake prices, used automatically when no API keys are set. */
  demo: env('DEMO_MODE') === 'true' || (!ignavKey && !travelpayoutsToken),
  dataDir: env('DATA_DIR') ?? './data',
  defaultLiveBudget: Number(env('DEFAULT_LIVE_BUDGET') ?? 25),
  maxLiveBudget: Number(env('MAX_LIVE_BUDGET') ?? 150),
};
