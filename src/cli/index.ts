#!/usr/bin/env node

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AnalyzerConfigSchema } from '../types/index.js';
import { runPipeline } from '../pipeline/index.js';

const program = new Command();

program
  .name('ui-canonicalizer')
  .description('Headless UI canonicalizer and drift detector for Tailwind-based HTML/JSX')
  .version('0.1.0');

program
  .command('analyze')
  .description('Analyze input directory and generate canonical UI output')
  .argument('<input>', 'Input directory containing HTML/JSX/TSX files')
  .option('-o, --out <dir>', 'Output directory', './out')
  .option('-c, --config <file>', 'Config file path')
  .option('-v, --verbose', 'Verbose output', false)
  .action(async (input: string, opts: { out: string; config?: string; verbose: boolean }) => {
    try {
      const inputDir = path.resolve(input);

      // Load config
      let rawConfig: Record<string, unknown> = {};
      if (opts.config) {
        const configContent = await readFile(path.resolve(opts.config), 'utf-8');
        rawConfig = JSON.parse(configContent);
      }

      // Merge CLI options
      rawConfig.output = { dir: path.resolve(opts.out) };
      rawConfig.verbose = opts.verbose;

      const config = AnalyzerConfigSchema.parse(rawConfig);

      console.log(`UI Canonicalizer v0.1.0`);
      console.log(`Input:  ${inputDir}`);
      console.log(`Output: ${config.output.dir}`);
      console.log('');

      const result = await runPipeline(inputDir, config);

      // Print summary
      const s = result.report.summary;
      console.log('');
      console.log('=== Analysis Complete ===');
      console.log(`  Files:       ${s.inputFileCount} (${s.parseSuccessCount} parsed, ${s.parseFailureCount} failed)`);
      console.log(`  Nodes:       ${s.totalNodeCount}`);
      console.log(`  Candidates:  ${s.totalCandidateCount}`);
      console.log(`  Clusters:    ${s.totalClusterCount}`);
      console.log(`  Drift issues: ${s.totalDriftIssueCount}`);
      console.log(`  Components:  ${result.canonicalOutput.meta.totalComponents}`);
      console.log('');

      // List detected components
      const components = Object.keys(result.canonicalOutput.canonicalComponents);
      if (components.length > 0) {
        console.log('Canonical components:');
        for (const name of components) {
          const comp = result.canonicalOutput.canonicalComponents[name];
          console.log(`  - ${name} (${(comp.confidence * 100).toFixed(0)}% confidence, found in ${comp.foundIn.length} files)`);
        }
        console.log('');
      }

      // List top drift issues
      const errors = result.driftIssues.filter(d => d.severity === 'error');
      const warnings = result.driftIssues.filter(d => d.severity === 'warning');
      if (errors.length > 0 || warnings.length > 0) {
        console.log('Top drift issues:');
        for (const issue of [...errors, ...warnings].slice(0, 5)) {
          const icon = issue.severity === 'error' ? '[ERROR]' : '[WARN]';
          console.log(`  ${icon} ${issue.description}`);
        }
        console.log('');
      }

      console.log(`Output written to: ${config.output.dir}`);
      console.log('  - canonical-ui.json (primary AI-consumable output)');
      console.log('  - analysis-summary.json');
      console.log('  - drift-report.json');
      console.log('  - summary.md');

    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
