import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UsageCounter } from './usage';

const tempDir = () => mkdtempSync(join(tmpdir(), 'flightscanner-usage-'));

describe('UsageCounter', () => {
  it('persists the count across restarts', () => {
    const dir = tempDir();
    const first = new UsageCounter(dir);
    first.increment();
    first.increment();
    expect(JSON.parse(readFileSync(join(dir, 'usage.json'), 'utf8'))).toEqual({ ignavRequests: 2 });
    expect(new UsageCounter(dir).ignavRequests).toBe(2);
  });

  it('creates a missing data directory', () => {
    const dir = join(tempDir(), 'nested', 'data');
    const counter = new UsageCounter(dir);
    counter.increment();
    expect(new UsageCounter(dir).ignavRequests).toBe(1);
  });

  it('starts from zero when the file is corrupt', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'usage.json'), '{not json');
    expect(new UsageCounter(dir).ignavRequests).toBe(0);
  });
});
