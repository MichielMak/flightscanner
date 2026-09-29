import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { errorFields, log } from './log';

/** Ignav's one-time free allowance. After this every request is billed. */
export const IGNAV_FREE_REQUESTS = 1000;
const WARN_AT = [0.8 * IGNAV_FREE_REQUESTS, IGNAV_FREE_REQUESTS];

/** Counts billed Ignav requests on disk so the UI can show how much of the free 1,000 is left. */
export class UsageCounter {
  private count: number;
  private file: string;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'usage.json');
    try {
      mkdirSync(dataDir, { recursive: true });
      this.count = (JSON.parse(readFileSync(this.file, 'utf8')) as { ignavRequests: number }).ignavRequests;
    } catch {
      this.count = 0;
    }
  }

  get ignavRequests(): number {
    return this.count;
  }

  increment(): void {
    this.count++;
    // Logged once, on the request that crosses the line, so it can drive an alert without repeating.
    if (WARN_AT.includes(this.count)) {
      log.warn('ignav.free_tier', {
        ignavRequests: this.count,
        freeRequests: IGNAV_FREE_REQUESTS,
        message:
          this.count >= IGNAV_FREE_REQUESTS
            ? 'Ignav free requests used up: live checks are now billed'
            : `Ignav free requests ${Math.round((this.count / IGNAV_FREE_REQUESTS) * 100)}% used`,
      });
    }
    try {
      writeFileSync(this.file, JSON.stringify({ ignavRequests: this.count }));
    } catch (e) {
      log.warn('usage.save_failed', errorFields(e));
    }
  }
}
