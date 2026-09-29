import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app';
import { config } from './config';
import { DemoCachedProvider, DemoLiveProvider } from './providers/demo';
import { IgnavProvider } from './providers/ignav';
import { TravelpayoutsProvider } from './providers/travelpayouts';
import { log } from './log';
import { SearchEngine } from './search';
import { UsageCounter } from './usage';

const usage = new UsageCounter(config.dataDir);

const engine = config.demo
  ? new SearchEngine(new DemoCachedProvider(), new DemoLiveProvider())
  : new SearchEngine(
      config.travelpayoutsToken
        ? new TravelpayoutsProvider(config.travelpayoutsToken, config.travelpayoutsMarket)
        : null,
      config.ignavKey ? new IgnavProvider(config.ignavKey, config.ignavMarket, () => usage.increment()) : null,
    );

const app = new Hono();
app.route('/', createApp(engine, usage));

// The built web app (npm run build). In development Vite serves it instead.
const webRoot = process.env.WEB_ROOT ?? './dist/web';
app.use('/*', serveStatic({ root: webRoot }));
app.get('*', serveStatic({ root: webRoot, path: 'index.html' }));

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  const { cached, live } = engine.providers;
  log.info('server.started', {
    url: `http://localhost:${port}`,
    version: config.version,
    cachedProvider: cached,
    liveProvider: live,
    demo: config.demo,
    ignavRequestsUsed: usage.ignavRequests,
  });
  if (config.demo)
    log.warn('server.demo_mode', { message: 'Prices are fake. Set IGNAV_API_KEY and TRAVELPAYOUTS_TOKEN.' });
});
