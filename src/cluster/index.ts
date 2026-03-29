import type { PatternCandidate, PatternCluster, AnalyzerConfig, VariantInfo, FamilyTag } from '../types/index.js';
import { compareNodes, compareFingerprints } from '../match/index.js';
import { generateId } from '../utils/ids.js';

export function clusterPatterns(
  candidates: PatternCandidate[],
  config: AnalyzerConfig,
): PatternCluster[] {
  if (candidates.length === 0) return [];

  const { nearMatchThreshold } = config.similarity;

  // Step 1: bucket by structural hash for pre-filtering
  const buckets = new Map<string, PatternCandidate[]>();
  for (const c of candidates) {
    const key = c.fingerprint.structural;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(c);
  }

  const clusters: PatternCluster[] = [];
  const assigned = new Set<string>();

  // Step 2: exact duplicates within buckets
  for (const [, bucket] of buckets) {
    const exactGroups = new Map<string, PatternCandidate[]>();
    for (const c of bucket) {
      const key = c.fingerprint.exact;
      if (!exactGroups.has(key)) exactGroups.set(key, []);
      exactGroups.get(key)!.push(c);
    }

    for (const [, group] of exactGroups) {
      if (group.length >= 2) {
        const representative = selectRepresentative(group);
        const members = group;
        for (const m of members) assigned.add(m.id);

        clusters.push(buildCluster(representative, members, config));
      }
    }
  }

  // Step 3: near-match clustering on unassigned candidates
  const unassigned = candidates.filter(c => !assigned.has(c.id));

  // Group unassigned by structural hash bucket for efficiency
  for (const [, bucket] of buckets) {
    const bucketUnassigned = bucket.filter(c => !assigned.has(c.id));
    if (bucketUnassigned.length < 2) continue;

    // Simple greedy clustering within bucket
    const remaining = new Set(bucketUnassigned.map(c => c.id));

    for (const seed of bucketUnassigned) {
      if (!remaining.has(seed.id)) continue;
      remaining.delete(seed.id);

      const group: PatternCandidate[] = [seed];

      for (const other of bucketUnassigned) {
        if (!remaining.has(other.id)) continue;

        const sim = compareNodes(seed, other, config);
        if (sim.score >= nearMatchThreshold) {
          group.push(other);
          remaining.delete(other.id);
        }
      }

      if (group.length >= 2) {
        const representative = selectRepresentative(group);
        clusters.push(buildCluster(representative, group, config));
        for (const m of group) assigned.add(m.id);
      }
    }
  }

  // Step 4: cross-bucket near-match for remaining unassigned
  const stillUnassigned = candidates.filter(c => !assigned.has(c.id));
  if (stillUnassigned.length >= 2) {
    const remaining = new Set(stillUnassigned.map(c => c.id));

    for (const seed of stillUnassigned) {
      if (!remaining.has(seed.id)) continue;
      remaining.delete(seed.id);

      const group: PatternCandidate[] = [seed];

      for (const other of stillUnassigned) {
        if (!remaining.has(other.id)) continue;

        // Quick pre-filter
        const quickScore = compareFingerprints(seed, other);
        if (quickScore < nearMatchThreshold * 0.5) continue;

        const sim = compareNodes(seed, other, config);
        if (sim.score >= nearMatchThreshold) {
          group.push(other);
          remaining.delete(other.id);
        }
      }

      if (group.length >= 2) {
        const representative = selectRepresentative(group);
        clusters.push(buildCluster(representative, group, config));
      }
    }
  }

  return clusters.sort((a, b) => b.members.length - a.members.length);
}

export function selectRepresentative(group: PatternCandidate[]): PatternCandidate {
  // Select the member with the most nodes (richest content)
  return group.reduce((best, c) =>
    c.fingerprint.shape.nodeCount > best.fingerprint.shape.nodeCount ? c : best
  );
}

function buildCluster(
  representative: PatternCandidate,
  members: PatternCandidate[],
  config: AnalyzerConfig,
): PatternCluster {
  // Compute similarity scores relative to representative
  const scores = members.map(m => compareNodes(representative, m, config).score);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);

  // Collect family tags from all members
  const familyMap = new Map<string, { total: number; count: number }>();
  for (const m of members) {
    for (const tag of m.familyTags) {
      const existing = familyMap.get(tag.family);
      if (existing) {
        existing.total += tag.confidence;
        existing.count++;
      } else {
        familyMap.set(tag.family, { total: tag.confidence, count: 1 });
      }
    }
  }
  const familyTags: FamilyTag[] = [...familyMap.entries()]
    .map(([family, { total, count }]) => ({ family, confidence: total / count }))
    .sort((a, b) => b.confidence - a.confidence);

  // Build variant info
  const variants: VariantInfo[] = members
    .filter(m => m.id !== representative.id)
    .map(m => ({
      memberId: m.id,
      diffs: computeDiffs(representative, m),
    }));

  return {
    id: generateId('cluster'),
    representative,
    members,
    familyTags,
    similaritySummary: { avgScore, minScore, maxScore },
    variants,
  };
}

function computeDiffs(representative: PatternCandidate, member: PatternCandidate): string[] {
  const diffs: string[] = [];

  const repClasses = new Set(representative.fingerprint.classSignature);
  const memClasses = new Set(member.fingerprint.classSignature);

  const added = [...memClasses].filter(c => !repClasses.has(c));
  const removed = [...repClasses].filter(c => !memClasses.has(c));

  if (added.length > 0) diffs.push(`added utilities: ${added.join(', ')}`);
  if (removed.length > 0) diffs.push(`removed utilities: ${removed.join(', ')}`);

  const repShape = representative.fingerprint.shape;
  const memShape = member.fingerprint.shape;

  if (repShape.childCount !== memShape.childCount) {
    diffs.push(`child count: ${repShape.childCount} → ${memShape.childCount}`);
  }
  if (repShape.interactiveCount !== memShape.interactiveCount) {
    diffs.push(`interactive elements: ${repShape.interactiveCount} → ${memShape.interactiveCount}`);
  }
  if (repShape.textSlotCount !== memShape.textSlotCount) {
    diffs.push(`text slots: ${repShape.textSlotCount} → ${memShape.textSlotCount}`);
  }

  return diffs;
}
