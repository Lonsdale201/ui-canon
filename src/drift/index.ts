import type { PatternCluster, DriftIssue, DriftSeverity, DriftType, UINode } from '../types/index.js';
import { generateId } from '../utils/ids.js';

// Tailwind utility category prefixes for drift detection
const TYPOGRAPHY_PREFIXES = ['text', 'font', 'leading', 'tracking', 'antialiased'];
const SPACING_PREFIXES = ['p', 'px', 'py', 'pt', 'pb', 'pl', 'pr', 'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr', 'gap', 'space'];
const COLOR_PREFIXES = ['bg', 'text', 'border', 'ring', 'outline', 'accent', 'fill', 'stroke'];
const RADIUS_SHADOW_PREFIXES = ['rounded', 'shadow'];

export function detectDrift(clusters: PatternCluster[]): DriftIssue[] {
  const issues: DriftIssue[] = [];

  for (const cluster of clusters) {
    if (cluster.members.length < 2) continue;

    // Collect all classes from all members
    const memberClassSets = cluster.members.map(m => collectAllClasses(m.node));

    // Detect category-specific drift
    issues.push(...detectCategoryDrift(cluster, memberClassSets, TYPOGRAPHY_PREFIXES, 'typography'));
    issues.push(...detectCategoryDrift(cluster, memberClassSets, SPACING_PREFIXES, 'spacing'));
    issues.push(...detectCategoryDrift(cluster, memberClassSets, COLOR_PREFIXES, 'color'));
    issues.push(...detectCategoryDrift(cluster, memberClassSets, RADIUS_SHADOW_PREFIXES, 'radius-shadow'));

    // Detect same-structure-different-utility drift
    issues.push(...detectUtilityDrift(cluster, memberClassSets));
  }

  return issues;
}

function detectCategoryDrift(
  cluster: PatternCluster,
  memberClassSets: string[][],
  prefixes: string[],
  type: DriftType,
): DriftIssue[] {
  const issues: DriftIssue[] = [];

  // For each prefix, collect the specific utilities used across members
  for (const prefix of prefixes) {
    const utilitiesPerMember = memberClassSets.map(classes =>
      classes.filter(c => {
        const stripped = c.replace(/^[a-z]+:/g, ''); // strip responsive/state prefixes
        return stripped.startsWith(prefix + '-') || stripped === prefix;
      }).sort().join(' ')
    );

    // Count unique utility patterns
    const patterns = new Set(utilitiesPerMember.filter(u => u.length > 0));
    if (patterns.size <= 1) continue; // No drift for this prefix

    // How many members diverge?
    const divergingCount = utilitiesPerMember.filter((u, i) => {
      const rep = utilitiesPerMember[0];
      return u !== rep && u.length > 0;
    }).length;

    const severity = classifyDriftSeverity(divergingCount, cluster.members.length);

    issues.push({
      id: generateId('drift'),
      type,
      severity,
      clusterId: cluster.id,
      description: `${type} drift on '${prefix}' utilities: ${patterns.size} different patterns across ${cluster.members.length} members`,
      affectedSources: cluster.members.map(m => m.source),
      details: {
        prefix,
        patterns: [...patterns],
        divergingCount,
      },
    });
  }

  return issues;
}

function detectUtilityDrift(
  cluster: PatternCluster,
  memberClassSets: string[][],
): DriftIssue[] {
  // If structural hash is the same but class sets differ significantly
  const structuralHashes = new Set(cluster.members.map(m => m.fingerprint.structural));
  if (structuralHashes.size > 1) return []; // Different structures, not this type of drift

  const classSets = memberClassSets.map(c => new Set(c));
  if (classSets.length < 2) return [];

  // Find classes that appear in some but not all members
  const allClasses = new Set(classSets.flatMap(s => [...s]));
  const inconsistent: string[] = [];

  for (const cls of allClasses) {
    const count = classSets.filter(s => s.has(cls)).length;
    if (count > 0 && count < classSets.length) {
      inconsistent.push(cls);
    }
  }

  if (inconsistent.length === 0) return [];

  const divergingRatio = inconsistent.length / allClasses.size;
  if (divergingRatio < 0.1) return []; // Too few differences to report

  const severity = classifyDriftSeverity(
    Math.ceil(cluster.members.length * divergingRatio),
    cluster.members.length,
  );

  return [{
    id: generateId('drift'),
    type: 'same-structure-different-utility',
    severity,
    clusterId: cluster.id,
    description: `Same structure but ${inconsistent.length} utility classes differ across ${cluster.members.length} members`,
    affectedSources: cluster.members.map(m => m.source),
    details: {
      inconsistentClasses: inconsistent.sort(),
      totalUniqueClasses: allClasses.size,
    },
  }];
}

export function classifyDriftSeverity(divergingCount: number, totalCount: number): DriftSeverity {
  if (totalCount <= 1) return 'info';
  const ratio = divergingCount / totalCount;
  if (ratio >= 0.6) return 'error';
  if (ratio >= 0.3) return 'warning';
  return 'info';
}

function collectAllClasses(node: UINode): string[] {
  const classes = [
    ...(node.classesNormalized.length > 0 ? node.classesNormalized : node.classesRaw),
  ];
  for (const child of node.children) {
    classes.push(...collectAllClasses(child));
  }
  return classes;
}
