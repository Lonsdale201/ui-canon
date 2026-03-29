import { z } from 'zod/v4';

// ─── UINode ───

export type UINodeType = 'element' | 'text' | 'fragment' | 'componentLike';

export interface SourceMeta {
  fileName: string;
  relativePath: string;
  extension: string;
  screenId: string;
}

export interface UINode {
  id: string;
  type: UINodeType;
  tagName: string;
  attributes: Record<string, string>;
  classesRaw: string[];
  classesNormalized: string[];
  textContent: string;
  children: UINode[];
  source: SourceMeta;
  loc?: { line: number; column: number };
  meta: Record<string, unknown>;
}

// ─── SourceFile ───

export interface SourceFile {
  fileName: string;
  relativePath: string;
  absolutePath: string;
  extension: string;
  screenId: string;
}

// ─── ParseResult ───

export interface ParseDiagnostic {
  level: 'info' | 'warning' | 'error';
  message: string;
  loc?: { line: number; column: number };
}

export interface ParseResult {
  source: SourceFile;
  root: UINode | null;
  diagnostics: ParseDiagnostic[];
  success: boolean;
}

// ─── Fingerprint ───

export interface NodeFingerprint {
  exact: string;
  structural: string;
  classSignature: string[];
  shape: ShapeDescriptor;
}

export interface ShapeDescriptor {
  depth: number;
  childCount: number;
  nodeCount: number;
  hasInteractive: boolean;
  hasText: boolean;
  hasImage: boolean;
  interactiveCount: number;
  textSlotCount: number;
}

// ─── Pattern / Cluster ───

export interface PatternCandidate {
  id: string;
  node: UINode;
  fingerprint: NodeFingerprint;
  familyTags: FamilyTag[];
  source: SourceMeta;
}

export interface FamilyTag {
  family: string;
  confidence: number;
}

export interface PatternCluster {
  id: string;
  representative: PatternCandidate;
  members: PatternCandidate[];
  familyTags: FamilyTag[];
  similaritySummary: {
    avgScore: number;
    minScore: number;
    maxScore: number;
  };
  variants: VariantInfo[];
}

export interface VariantInfo {
  memberId: string;
  diffs: string[];
}

// ─── Drift ───

export type DriftSeverity = 'info' | 'warning' | 'error';

export type DriftType =
  | 'typography'
  | 'spacing'
  | 'color'
  | 'radius-shadow'
  | 'button-style'
  | 'same-structure-different-utility';

export interface DriftIssue {
  id: string;
  type: DriftType;
  severity: DriftSeverity;
  clusterId: string;
  description: string;
  affectedSources: SourceMeta[];
  details: Record<string, unknown>;
}

// ─── Canonical Suggestion ───

export interface SlotSuggestion {
  name: string;
  description: string;
  occurrences: number;
}

export interface VariantSuggestion {
  name: string;
  diffs: string[];
}

export interface CanonicalSuggestion {
  componentName: string;
  family: string;
  representativeHtml: string;
  slots: SlotSuggestion[];
  variants: VariantSuggestion[];
  commonClasses: string[];
  foundIn: string[];
  confidence: number;
}

// ─── Canonical Output (primary AI-consumable output) ───

export interface CanonicalComponentOutput {
  representativeHtml: string;
  slots: string[];
  variants: { name: string; diff: string[] }[];
  foundIn: string[];
  confidence: number;
}

export interface NormalizedScreenOutput {
  componentsUsed: string[];
  structure: string[];  // compact outline: e.g. ["SideNav", "TopBar", "section > FormGroup3", "section > DataTable"]
}

export interface DesignTokensOutput {
  colors: Record<string, string>;
  fontFamily: Record<string, string[]>;
  borderRadius: Record<string, string>;
  customCss: string[];
  fontImports: string[];
  iconSystem: string | null;
}

export interface LayoutRegionOutput {
  role: string;
  comment: string | null;
  tag: string;
  width: string | null;
  position: string | null;
  children: LayoutRegionOutput[];
}

export interface ScreenLayoutOutput {
  regions: LayoutRegionOutput[];
}

export interface LayoutDriftOutput {
  region: string;
  property: string;
  screens: { screen: string; value: string }[];
  description: string;
}

export interface CanonicalOutput {
  aiGuidance: string;
  meta: {
    generatedAt: string;
    inputFiles: number;
    totalComponents: number;
  };
  designTokens: DesignTokensOutput;
  layout: {
    screens: Record<string, ScreenLayoutOutput>;
    drift: LayoutDriftOutput[];
  };
  canonicalComponents: Record<string, CanonicalComponentOutput>;
  screenMap: Record<string, NormalizedScreenOutput>;
  attachedFiles?: Record<string, string>;
}

// ─── Report ───

export interface AnalysisSummary {
  inputFileCount: number;
  parseSuccessCount: number;
  parseFailureCount: number;
  parseWarningCount: number;
  totalNodeCount: number;
  totalCandidateCount: number;
  totalClusterCount: number;
  totalDriftIssueCount: number;
  pipelineTiming: Record<string, number>;
}

export interface ReportDocument {
  summary: AnalysisSummary;
  driftIssues: DriftIssue[];
  canonicalSuggestions: CanonicalSuggestion[];
}

// ─── Similarity ───

export interface SimilarityResult {
  score: number;
  structureScore: number;
  classScore: number;
  childShapeScore: number;
  roleScore: number;
}

// ─── Config ───

export const AnalyzerConfigSchema = z.object({
  inputGlobs: z.array(z.string()).default(['**/*.html', '**/*.jsx', '**/*.tsx']),
  exclude: z.array(z.string()).default(['node_modules/**', 'dist/**', '.next/**']),
  candidate: z.object({
    minDepth: z.number().default(2),
    minNodeCount: z.number().default(5),
    rootTagHints: z.array(z.string()).default([
      'header', 'nav', 'table', 'form', 'dialog', 'section', 'aside', 'main', 'footer',
    ]),
  }).default(() => ({ minDepth: 2, minNodeCount: 5, rootTagHints: ['header', 'nav', 'table', 'form', 'dialog', 'section', 'aside', 'main', 'footer'] })),
  similarity: z.object({
    exactMatchThreshold: z.number().default(1.0),
    nearMatchThreshold: z.number().default(0.75),
    driftThreshold: z.number().default(0.5),
    structureWeight: z.number().default(0.4),
    classWeight: z.number().default(0.3),
    childShapeWeight: z.number().default(0.2),
    roleHeuristicWeight: z.number().default(0.1),
  }).default(() => ({ exactMatchThreshold: 1.0, nearMatchThreshold: 0.75, driftThreshold: 0.5, structureWeight: 0.4, classWeight: 0.3, childShapeWeight: 0.2, roleHeuristicWeight: 0.1 })),
  attachFiles: z.array(z.string()).default([]).describe(
    'Glob patterns for extra files to attach to canonical-ui.json (e.g. ["DESIGN.md", "*.md"]). Content is included as-is in the output.'
  ),
  excludeFiles: z.array(z.string()).default([]).describe(
    'Glob patterns for files to explicitly exclude from analysis, on top of the default excludes (e.g. ["drafts/**", "old-*.html"])'
  ),
  output: z.object({
    dir: z.string().default('./out'),
  }).default(() => ({ dir: './out' })),
  verbose: z.boolean().default(false),
  maxFileSizeBytes: z.number().default(1_000_000), // 1MB
});

export type AnalyzerConfig = z.infer<typeof AnalyzerConfigSchema>;
