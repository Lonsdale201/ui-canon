import { describe, it, expect, beforeEach } from 'vitest';
import { runPipeline } from '../src/pipeline/index.js';
import { AnalyzerConfigSchema } from '../src/types/index.js';
import { resetIdCounter } from '../src/utils/ids.js';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

const FIXTURES_DIR = path.resolve('fixtures/basic');
const OUT_DIR = path.resolve('test-out');

beforeEach(async () => {
  resetIdCounter();
  if (existsSync(OUT_DIR)) {
    await rm(OUT_DIR, { recursive: true });
  }
});

describe('pipeline integration', () => {
  it('should run full pipeline on fixture files', async () => {
    const config = AnalyzerConfigSchema.parse({
      output: { dir: OUT_DIR },
      verbose: false,
    });

    const result = await runPipeline(FIXTURES_DIR, config);

    // Basic assertions
    expect(result.report.summary.inputFileCount).toBe(3);
    expect(result.report.summary.parseSuccessCount).toBe(3);
    expect(result.report.summary.parseFailureCount).toBe(0);
    expect(result.report.summary.totalNodeCount).toBeGreaterThan(0);
    expect(result.report.summary.totalCandidateCount).toBeGreaterThan(0);

    // Should find clusters (headers, tables appear in multiple screens)
    expect(result.report.summary.totalClusterCount).toBeGreaterThan(0);

    // Should generate canonical components
    expect(result.canonicalOutput.meta.totalComponents).toBeGreaterThan(0);
    expect(Object.keys(result.canonicalOutput.canonicalComponents).length).toBeGreaterThan(0);

    // Should have screen map
    expect(Object.keys(result.canonicalOutput.screenMap).length).toBe(3);

    // Output files should exist
    expect(existsSync(path.join(OUT_DIR, 'canonical-ui.json'))).toBe(true);
    expect(existsSync(path.join(OUT_DIR, 'analysis-summary.json'))).toBe(true);
    expect(existsSync(path.join(OUT_DIR, 'drift-report.json'))).toBe(true);
    expect(existsSync(path.join(OUT_DIR, 'summary.md'))).toBe(true);
  }, 30000);
});
