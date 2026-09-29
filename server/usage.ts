import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
    try {
      writeFileSync(this.file, JSON.stringify({ ignavRequests: this.count }));
    } catch (e) {
      console.warn('Could not save usage counter:', e);
    }
  }
}
