import type { AnalyzerConfig, ParseResult, PatternCandidate, PatternCluster, DriftIssue, CanonicalSuggestion, CanonicalOutput, AnalysisSummary, ReportDocument, SourceMeta } from '../types/index.js';
import { collectSourceFiles, readSourceFile, collectAttachedFiles } from '../ingest/index.js';
import { parseSourceFile } from '../parse/index.js';
import { normalizeTree } from '../normalize/index.js';
import { extractCandidates } from '../extract/index.js';
import { clusterPatterns } from '../cluster/index.js';
import { detectDrift } from '../drift/index.js';
import { suggestCanonicalComponents } from '../suggest/index.js';
import { extractDesignTokens } from '../extract/design-tokens.js';
import { buildCanonicalOutput, buildReport, writeAllOutputs } from '../output/index.js';
import { countNodes } from '../utils/html.js';
import { resetIdCounter } from '../utils/ids.js';

export interface PipelineResult {
  canonicalOutput: CanonicalOutput;
  report: ReportDocument;
  driftIssues: DriftIssue[];
  timing: Record<string, number>;
}

export async function runPipeline(
  inputDir: string,
  config: AnalyzerConfig,
): Promise<PipelineResult> {
  const timing: Record<string, number> = {};
  const log = config.verbose ? console.log.bind(console) : () => {};

  // Reset ID counter for deterministic output
  resetIdCounter();

  // Step 1: Ingest
  let t = Date.now();
  const sourceFiles = await collectSourceFiles(inputDir, config);
  timing['ingest'] = Date.now() - t;
  log(`[ingest] Found ${sourceFiles.length} files`);

  // Step 2: Parse + collect raw content for design token extraction
  t = Date.now();
  const parseResults: ParseResult[] = [];
  const rawContents: { fileName: string; content: string }[] = [];
  for (const file of sourceFiles) {
    try {
      const raw = await readSourceFile(file);
      rawContents.push({ fileName: file.fileName, content: raw });
      const result = parseSourceFile(file, raw);
      parseResults.push(result);
    } catch (err) {
      parseResults.push({
        source: file,
        root: null,
        diagnostics: [{
          level: 'error',
          message: `Read error: ${err instanceof Error ? err.message : String(err)}`,
        }],
        success: false,
      });
    }
  }
  timing['parse'] = Date.now() - t;
  const successCount = parseResults.filter(r => r.success).length;
  log(`[parse] ${successCount}/${parseResults.length} files parsed successfully`);

  // Step 3: Normalize
  t = Date.now();
  const normalizedResults: ParseResult[] = parseResults.map(r => {
    if (!r.success || !r.root) return r;
    return {
      ...r,
      root: normalizeTree(r.root, { abstractText: true, stripWrappers: true }),
    };
  });
  timing['normalize'] = Date.now() - t;
  log(`[normalize] Done`);

  // Step 4: Extract candidates
  t = Date.now();
  const trees = normalizedResults
    .filter(r => r.success && r.root)
    .map(r => ({
      root: r.root!,
      source: {
        fileName: r.source.fileName,
        relativePath: r.source.relativePath,
        extension: r.source.extension,
        screenId: r.source.screenId,
      } as SourceMeta,
    }));

  const candidates = extractCandidates(trees, config);
  timing['extract'] = Date.now() - t;
  log(`[extract] Found ${candidates.length} pattern candidates`);

  // Step 5+6+7: Cluster (includes fingerprinting and matching internally)
  t = Date.now();
  const clusters = clusterPatterns(candidates, config);
  timing['cluster'] = Date.now() - t;
  log(`[cluster] Found ${clusters.length} clusters`);

  // Step 8: Drift detection
  t = Date.now();
  const driftIssues = detectDrift(clusters);
  timing['drift'] = Date.now() - t;
  log(`[drift] Found ${driftIssues.length} drift issues`);

  // Step 9: Suggest canonical components
  t = Date.now();
  const suggestions = suggestCanonicalComponents(clusters);
  timing['suggest'] = Date.now() - t;
  log(`[suggest] Generated ${suggestions.length} canonical component suggestions`);

  // Step 10: Extract design tokens + Build outputs
  t = Date.now();
  const designTokens = extractDesignTokens(rawContents);
  log(`[tokens] Extracted ${Object.keys(designTokens.colors).length} colors, ${Object.keys(designTokens.fontFamily).length} font families`);

  const canonicalOutput = buildCanonicalOutput(clusters, suggestions, normalizedResults, designTokens);

  // Attach extra files if configured
  if (config.attachFiles.length > 0) {
    const attached = await collectAttachedFiles(inputDir, config.attachFiles);
    if (Object.keys(attached).length > 0) {
      canonicalOutput.attachedFiles = attached;
      log(`[attach] Attached ${Object.keys(attached).length} files: ${Object.keys(attached).join(', ')}`);
    }
  }

  // Compute summary
  let totalNodeCount = 0;
  for (const r of normalizedResults) {
    if (r.root) totalNodeCount += countNodes(r.root);
  }

  const warningCount = parseResults.reduce(
    (acc, r) => acc + r.diagnostics.filter(d => d.level === 'warning').length,
    0,
  );

  const summary: AnalysisSummary = {
    inputFileCount: sourceFiles.length,
    parseSuccessCount: successCount,
    parseFailureCount: parseResults.filter(r => !r.success).length,
    parseWarningCount: warningCount,
    totalNodeCount,
    totalCandidateCount: candidates.length,
    totalClusterCount: clusters.length,
    totalDriftIssueCount: driftIssues.length,
    pipelineTiming: timing,
  };

  const report = buildReport(summary, driftIssues, suggestions);

  // Write outputs
  await writeAllOutputs(canonicalOutput, report, driftIssues, config.output.dir);
  timing['output'] = Date.now() - t;
  log(`[output] Written to ${config.output.dir}`);

  return { canonicalOutput, report, driftIssues, timing };
}
