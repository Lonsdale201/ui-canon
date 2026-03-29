#!/usr/bin/env node

/**
 * MCP Server for UI Canonicalizer.
 *
 * This allows an AI agent to send HTML content (e.g. fetched via Stitch MCP)
 * directly to the canonicalizer without saving files to disk first.
 *
 * Usage:
 *   node dist/mcp/index.js
 *
 * The server exposes two tools:
 *   - analyze_files: accepts an array of {name, content} HTML files, returns canonical-ui.json
 *   - analyze_directory: accepts a local directory path, returns canonical-ui.json
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';
import { writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AnalyzerConfigSchema } from '../types/index.js';
import { runPipeline } from '../pipeline/index.js';

const server = new McpServer({
  name: 'ui-canonicalizer',
  version: '0.1.0',
});

// Tool 1: Analyze inline HTML content (for MCP-to-MCP workflow)
server.tool(
  'analyze_files',
  `Analyze HTML/JSX files and produce a canonical UI specification.
Send an array of files with their content (e.g. from Stitch MCP exports).
Returns a canonical-ui.json with design tokens, canonical components, and drift analysis.`,
  {
    files: z.array(z.object({
      name: z.string().describe('File name, e.g. "dashboard.html"'),
      content: z.string().describe('Full HTML content of the file'),
    })).describe('Array of HTML files to analyze'),
    config: z.object({
      nearMatchThreshold: z.number().optional().describe('Similarity threshold for clustering (0-1, default 0.75)'),
      minNodeCount: z.number().optional().describe('Minimum node count for candidate extraction (default 5)'),
    }).optional().describe('Optional config overrides'),
  },
  async ({ files, config }) => {
    // Write files to a temp directory
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ui-canon-'));
    const outDir = path.join(tmpDir, 'out');

    try {
      // Write each file
      for (const file of files) {
        await writeFile(path.join(tmpDir, file.name), file.content, 'utf-8');
      }

      // Build config
      const rawConfig: Record<string, unknown> = {
        output: { dir: outDir },
      };
      if (config?.nearMatchThreshold) {
        rawConfig.similarity = { nearMatchThreshold: config.nearMatchThreshold };
      }
      if (config?.minNodeCount) {
        rawConfig.candidate = { minNodeCount: config.minNodeCount };
      }

      const analyzerConfig = AnalyzerConfigSchema.parse(rawConfig);
      const result = await runPipeline(tmpDir, analyzerConfig);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result.canonicalOutput, null, 2),
        }],
      };
    } finally {
      // Cleanup temp dir
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  },
);

// Tool 2: Analyze a local directory (classic mode, exposed via MCP)
server.tool(
  'analyze_directory',
  `Analyze HTML/JSX files in a local directory and produce a canonical UI specification.
Same as running 'ui-canonicalizer analyze ./dir' from CLI, but via MCP.`,
  {
    directory: z.string().describe('Absolute path to directory containing HTML/JSX files'),
    outputDir: z.string().optional().describe('Output directory (default: ./out inside the input dir)'),
  },
  async ({ directory, outputDir }) => {
    const outDir = outputDir || path.join(directory, 'out');

    const config = AnalyzerConfigSchema.parse({
      output: { dir: outDir },
    });

    const result = await runPipeline(directory, config);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(result.canonicalOutput, null, 2),
      }],
    };
  },
);

// Tool 3: Save the last analysis result to disk
server.tool(
  'save_output',
  `Save a canonical-ui.json (and related reports) to a local directory.
Use this after analyze_files if you want to keep the results on disk for later use.
Pass the JSON string you received from analyze_files as the "canonicalUiJson" parameter.`,
  {
    canonicalUiJson: z.string().describe('The canonical-ui.json content (JSON string) from a previous analyze_files call'),
    outputDir: z.string().describe('Absolute path to the directory where output files should be saved'),
  },
  async ({ canonicalUiJson, outputDir }) => {
    try {
      await mkdir(outputDir, { recursive: true });

      const parsed = JSON.parse(canonicalUiJson);

      // Write canonical-ui.json
      await writeFile(
        path.join(outputDir, 'canonical-ui.json'),
        JSON.stringify(parsed, null, 2),
        'utf-8',
      );

      // Write summary.md if we have enough data
      const components = Object.keys(parsed.canonicalComponents || {});
      const lines = [
        '# UI Canonicalizer – Saved Output',
        '',
        `**Saved at:** ${new Date().toISOString()}`,
        `**Components:** ${components.length}`,
        '',
        '## Components',
        '',
        ...components.map(name => {
          const c = parsed.canonicalComponents[name];
          return `- **${name}** (${(c.confidence * 100).toFixed(0)}% confidence, found in: ${c.foundIn.join(', ')})`;
        }),
        '',
      ];
      await writeFile(path.join(outputDir, 'summary.md'), lines.join('\n'), 'utf-8');

      const savedFiles = ['canonical-ui.json', 'summary.md'];

      return {
        content: [{
          type: 'text' as const,
          text: `Saved ${savedFiles.length} files to ${outputDir}:\n${savedFiles.map(f => '  - ' + f).join('\n')}`,
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error saving output: ${err instanceof Error ? err.message : String(err)}`,
        }],
      };
    }
  },
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
