import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  PatternCluster, CanonicalSuggestion, DriftIssue,
  CanonicalOutput, DesignTokensOutput, StyleCatalogOutput, ReportDocument, AnalysisSummary, ParseResult,
  LayoutRegionOutput,
} from '../types/index.js';
import type { ScreenLayout, LayoutDriftIssue, LayoutRegion } from '../extract/layout.js';

const AI_GUIDANCE = `This file describes a UI design system extracted from multiple screens.

HOW TO USE THIS FILE:
1. "designTokens" contains the exact colors, fonts, border-radii, and custom CSS. Use these values — do not invent new ones.
2. "canonicalComponents" lists each reusable UI component with its canonical HTML. When building new screens, use these components as-is. Text placeholders (__ACTION_TEXT__, __TEXT__) should be replaced with real content.
3. "layout" describes each screen's spatial structure (sidebar, header, content regions) with widths and positions. "layout.drift" flags inconsistencies across screens (e.g. sidebar width 30% in one screen but 25% in another).
4. "screenMap" shows which components each original screen used.
5. "styleCatalog" lists the exact button, badge, input, and heading styles found across screens with their classes and occurrence counts. Use these exact styles — do not invent new button or badge variants.
6. "variants" on a component describe known variations. Pick the closest variant or use the default representative.
7. Classes use Tailwind CSS with custom colors from designTokens.colors (e.g. "bg-primary" maps to the "primary" color token).

IMPORTANT: Maintain visual consistency across all screens. Do not mix styles from different components. Respect the layout structure — sidebar width, header position, content arrangement must be consistent.`;

export function buildCanonicalOutput(
  clusters: PatternCluster[],
  suggestions: CanonicalSuggestion[],
  parseResults: ParseResult[],
  designTokens: DesignTokensOutput,
  screenLayouts: ScreenLayout[] = [],
  layoutDriftIssues: LayoutDriftIssue[] = [],
  styleCatalog?: StyleCatalogOutput,
): CanonicalOutput {
  const canonicalComponents: CanonicalOutput['canonicalComponents'] = {};

  for (const suggestion of suggestions) {
    canonicalComponents[suggestion.componentName] = {
      representativeHtml: suggestion.representativeHtml,
      slots: suggestion.slots.map(s => s.name),
      variants: suggestion.variants.map(v => ({ name: v.name, diff: v.diffs, intent: v.intent, reason: v.reason })),
      foundIn: suggestion.foundIn,
      confidence: suggestion.confidence,
    };
  }

  // Build compact screen map (component references only, no full HTML)
  const screenMap: CanonicalOutput['screenMap'] = {};
  for (const pr of parseResults) {
    if (!pr.success || !pr.root) continue;

    const componentsUsed: string[] = [];
    const structure: string[] = [];

    for (const suggestion of suggestions) {
      if (suggestion.foundIn.includes(pr.source.relativePath)) {
        componentsUsed.push(`${suggestion.componentName}:default`);
        structure.push(suggestion.componentName);
      }
    }

    screenMap[pr.source.relativePath] = {
      componentsUsed,
      structure,
    };
  }

  // Build layout section
  const layoutScreens: CanonicalOutput['layout']['screens'] = {};
  for (const sl of screenLayouts) {
    layoutScreens[sl.fileName] = {
      regions: sl.regions.map(regionToOutput),
    };
  }

  return {
    aiGuidance: AI_GUIDANCE,
    meta: {
      generatedAt: new Date().toISOString(),
      inputFiles: parseResults.length,
      totalComponents: suggestions.length,
    },
    designTokens,
    styleCatalog: styleCatalog || { buttons: [], badges: [], inputs: [], headings: [] },
    layout: {
      screens: layoutScreens,
      drift: layoutDriftIssues.map(d => ({
        region: d.region,
        property: d.property,
        screens: d.screens,
        description: d.description,
      })),
    },
    canonicalComponents,
    screenMap,
  };
}

function regionToOutput(r: LayoutRegion): LayoutRegionOutput {
  return {
    role: r.role,
    comment: r.comment,
    tag: r.tag,
    width: r.width,
    position: r.position,
    children: r.children.map(regionToOutput),
  };
}

export function buildReport(
  summary: AnalysisSummary,
  driftIssues: DriftIssue[],
  suggestions: CanonicalSuggestion[],
): ReportDocument {
  return {
    summary,
    driftIssues,
    canonicalSuggestions: suggestions,
  };
}

export async function writeAllOutputs(
  canonicalOutput: CanonicalOutput,
  report: ReportDocument,
  driftIssues: DriftIssue[],
  outDir: string,
): Promise<void> {
  await mkdir(outDir, { recursive: true });

  await Promise.all([
    writeFile(
      path.join(outDir, 'canonical-ui.json'),
      JSON.stringify(canonicalOutput, null, 2),
      'utf-8',
    ),
    writeFile(
      path.join(outDir, 'analysis-summary.json'),
      JSON.stringify(report.summary, null, 2),
      'utf-8',
    ),
    writeFile(
      path.join(outDir, 'drift-report.json'),
      JSON.stringify(driftIssues, null, 2),
      'utf-8',
    ),
    writeMarkdownSummary(report, canonicalOutput, path.join(outDir, 'summary.md')),
  ]);
}

export async function writeMarkdownSummary(
  report: ReportDocument,
  canonical: CanonicalOutput,
  filePath: string,
): Promise<void> {
  const s = report.summary;
  const lines: string[] = [
    '# UI Canonicalizer – Analysis Summary',
    '',
    `**Generated:** ${canonical.meta.generatedAt}`,
    '',
    '## Overview',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Input files | ${s.inputFileCount} |`,
    `| Parse success | ${s.parseSuccessCount} |`,
    `| Parse failures | ${s.parseFailureCount} |`,
    `| Parse warnings | ${s.parseWarningCount} |`,
    `| Total nodes | ${s.totalNodeCount} |`,
    `| Pattern candidates | ${s.totalCandidateCount} |`,
    `| Clusters | ${s.totalClusterCount} |`,
    `| Drift issues | ${s.totalDriftIssueCount} |`,
    '',
    '## Design Tokens',
    '',
    `- **Colors:** ${Object.keys(canonical.designTokens.colors).length} defined`,
    `- **Primary:** ${canonical.designTokens.colors['primary'] || 'N/A'}`,
    `- **Fonts:** ${Object.entries(canonical.designTokens.fontFamily).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' | ')}`,
    `- **Border radius:** ${canonical.designTokens.borderRadius['DEFAULT'] || 'default'}`,
    `- **Icon system:** ${canonical.designTokens.iconSystem || 'none'}`,
    '',
  ];

  // Canonical components
  const components = Object.entries(canonical.canonicalComponents);
  if (components.length > 0) {
    lines.push('## Canonical Components', '');
    for (const [name, comp] of components) {
      lines.push(`### ${name}`);
      lines.push(`- **Confidence:** ${(comp.confidence * 100).toFixed(0)}%`);
      lines.push(`- **Found in:** ${comp.foundIn.join(', ')}`);
      if (comp.slots.length > 0) {
        lines.push(`- **Slots:** ${comp.slots.join(', ')}`);
      }
      if (comp.variants.length > 0) {
        lines.push(`- **Variants:** ${comp.variants.map(v => v.name).join(', ')}`);
      }
      lines.push('');
    }
  }

  // Screen map
  const screens = Object.entries(canonical.screenMap);
  if (screens.length > 0) {
    lines.push('## Screen Composition', '');
    for (const [name, screen] of screens) {
      lines.push(`### ${name}`);
      lines.push(`Components: ${screen.structure.join(', ')}`);
      lines.push('');
    }
  }

  // Drift issues
  const driftIssues = report.driftIssues;
  if (driftIssues.length > 0) {
    lines.push('## Drift Issues', '');
    const errors = driftIssues.filter(d => d.severity === 'error');
    const warnings = driftIssues.filter(d => d.severity === 'warning');

    if (errors.length > 0) {
      lines.push(`### Errors (${errors.length})`, '');
      for (const e of errors.slice(0, 10)) {
        lines.push(`- **${e.type}**: ${e.description}`);
      }
      if (errors.length > 10) lines.push(`- ... and ${errors.length - 10} more`);
      lines.push('');
    }
    if (warnings.length > 0) {
      lines.push(`### Warnings (${warnings.length})`, '');
      for (const w of warnings.slice(0, 10)) {
        lines.push(`- **${w.type}**: ${w.description}`);
      }
      if (warnings.length > 10) lines.push(`- ... and ${warnings.length - 10} more`);
      lines.push('');
    }
  }

  await writeFile(filePath, lines.join('\n'), 'utf-8');
}
