import type { PatternCandidate, SimilarityResult, AnalyzerConfig } from '../types/index.js';

export function compareNodes(
  a: PatternCandidate,
  b: PatternCandidate,
  config: AnalyzerConfig,
): SimilarityResult {
  const weights = config.similarity;

  const structureScore = a.fingerprint.structural === b.fingerprint.structural ? 1.0 : computeStructuralSimilarity(a, b);
  const classScore = jaccardSimilarity(a.fingerprint.classSignature, b.fingerprint.classSignature);
  const childShapeScore = computeShapeSimilarity(a, b);
  const roleScore = computeRoleSimilarity(a, b);

  const score =
    structureScore * weights.structureWeight +
    classScore * weights.classWeight +
    childShapeScore * weights.childShapeWeight +
    roleScore * weights.roleHeuristicWeight;

  return { score, structureScore, classScore, childShapeScore, roleScore };
}

export function compareFingerprints(a: PatternCandidate, b: PatternCandidate): number {
  // Quick pre-filter: if structural hashes match, high likelihood of similarity
  if (a.fingerprint.exact === b.fingerprint.exact) return 1.0;
  if (a.fingerprint.structural === b.fingerprint.structural) return 0.8;
  return jaccardSimilarity(a.fingerprint.classSignature, b.fingerprint.classSignature) * 0.5;
}

function computeStructuralSimilarity(a: PatternCandidate, b: PatternCandidate): number {
  // Compare shape descriptors
  const sa = a.fingerprint.shape;
  const sb = b.fingerprint.shape;

  let score = 0;
  let factors = 0;

  // Depth similarity
  const maxDepth = Math.max(sa.depth, sb.depth, 1);
  score += 1 - Math.abs(sa.depth - sb.depth) / maxDepth;
  factors++;

  // Node count similarity
  const maxNodes = Math.max(sa.nodeCount, sb.nodeCount, 1);
  score += 1 - Math.abs(sa.nodeCount - sb.nodeCount) / maxNodes;
  factors++;

  // Child count similarity
  const maxChildren = Math.max(sa.childCount, sb.childCount, 1);
  score += 1 - Math.abs(sa.childCount - sb.childCount) / maxChildren;
  factors++;

  // Interactive element match
  if (sa.hasInteractive === sb.hasInteractive) {
    score += 1;
  }
  factors++;

  return score / factors;
}

function computeShapeSimilarity(a: PatternCandidate, b: PatternCandidate): number {
  const sa = a.fingerprint.shape;
  const sb = b.fingerprint.shape;

  let matches = 0;
  let total = 4;

  if (sa.hasInteractive === sb.hasInteractive) matches++;
  if (sa.hasText === sb.hasText) matches++;
  if (sa.hasImage === sb.hasImage) matches++;

  // Interactive count proximity
  const maxInt = Math.max(sa.interactiveCount, sb.interactiveCount, 1);
  matches += 1 - Math.abs(sa.interactiveCount - sb.interactiveCount) / maxInt;

  return matches / total;
}

function computeRoleSimilarity(a: PatternCandidate, b: PatternCandidate): number {
  if (a.familyTags.length === 0 && b.familyTags.length === 0) return 1.0;
  if (a.familyTags.length === 0 || b.familyTags.length === 0) return 0.0;

  const aFamilies = new Set(a.familyTags.map(t => t.family));
  const bFamilies = new Set(b.familyTags.map(t => t.family));

  const intersection = [...aFamilies].filter(f => bFamilies.has(f));
  if (intersection.length === 0) return 0.0;

  return intersection.length / Math.max(aFamilies.size, bFamilies.size);
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1.0 : intersection / union;
}
