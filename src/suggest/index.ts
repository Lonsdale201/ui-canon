import type {
  PatternCluster, CanonicalSuggestion, VariantSuggestion,
  SlotSuggestion, UINode,
} from '../types/index.js';
import { serializeNode } from '../utils/html.js';

const FAMILY_TO_NAME: Record<string, string> = {
  'header': 'PageHeader',
  'nav': 'SideNav',
  'table': 'DataTable',
  'modal': 'ModalShell',
  'form-group': 'FormGroup',
  'card': 'InfoCard',
  'toolbar': 'FilterToolbar',
  'footer': 'PageFooter',
};

export function suggestCanonicalComponents(clusters: PatternCluster[]): CanonicalSuggestion[] {
  const suggestions: CanonicalSuggestion[] = [];
  const usedNames = new Set<string>();

  for (const cluster of clusters) {
    const family = cluster.familyTags[0]?.family || 'component';
    let baseName = FAMILY_TO_NAME[family] || pascalCase(family);

    // Deduplicate names
    let name = baseName;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${baseName}${suffix++}`;
    }
    usedNames.add(name);

    const representative = cluster.representative;
    const representativeHtml = serializeNode(representative.node);

    const commonClasses = findCommonClasses(cluster);
    const slots = identifySlots(cluster);
    const variants = inferVariants(cluster);
    const foundIn = [...new Set(cluster.members.map(m => m.source.relativePath))];

    const confidence = cluster.familyTags[0]?.confidence || 0.5;

    suggestions.push({
      componentName: name,
      family,
      representativeHtml,
      slots,
      variants,
      commonClasses,
      foundIn,
      confidence,
    });
  }

  return mergeSameFamily(suggestions).sort((a, b) => b.confidence - a.confidence);
}

/**
 * Merge suggestions that share the same family into a single component
 * with combined variants, foundIn, and the representative from the
 * highest-confidence member.
 */
function mergeSameFamily(suggestions: CanonicalSuggestion[]): CanonicalSuggestion[] {
  const familyGroups = new Map<string, CanonicalSuggestion[]>();

  for (const s of suggestions) {
    const group = familyGroups.get(s.family);
    if (group) {
      group.push(s);
    } else {
      familyGroups.set(s.family, [s]);
    }
  }

  const merged: CanonicalSuggestion[] = [];

  for (const [, group] of familyGroups) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }

    // Sort descending by confidence so the best one is first
    group.sort((a, b) => b.confidence - a.confidence);
    const best = group[0];

    // Use the base name (no numeric suffix) from the highest-confidence member
    const baseName = FAMILY_TO_NAME[best.family] || pascalCase(best.family);

    // Combine foundIn from all members, deduplicated
    const combinedFoundIn = [...new Set(group.flatMap(s => s.foundIn))];

    // Combine variants from all members, dedup by name
    const seenVariantNames = new Set<string>();
    const combinedVariants: VariantSuggestion[] = [];
    for (const s of group) {
      for (const v of s.variants) {
        if (!seenVariantNames.has(v.name)) {
          seenVariantNames.add(v.name);
          combinedVariants.push(v);
        }
      }
    }

    merged.push({
      componentName: baseName,
      family: best.family,
      representativeHtml: best.representativeHtml,
      slots: best.slots,
      variants: combinedVariants,
      commonClasses: best.commonClasses,
      foundIn: combinedFoundIn,
      confidence: best.confidence,
    });
  }

  return merged;
}

export function inferVariants(cluster: PatternCluster): VariantSuggestion[] {
  if (cluster.variants.length === 0) return [];

  // Group variants by similar diffs
  const variantMap = new Map<string, { diffs: string[]; count: number }>();

  for (const v of cluster.variants) {
    const key = v.diffs.sort().join('|');
    const existing = variantMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      variantMap.set(key, { diffs: v.diffs, count: 1 });
    }
  }

  const suggestions: VariantSuggestion[] = [];
  let idx = 1;

  for (const [, { diffs, count }] of variantMap) {
    if (diffs.length === 0) continue;

    // Try to generate a descriptive name
    let name = `variant-${idx++}`;
    if (diffs.some(d => d.includes('interactive'))) name = 'with-actions';
    else if (diffs.some(d => d.includes('added utilities'))) name = 'extended';
    else if (diffs.some(d => d.includes('removed utilities'))) name = 'minimal';

    suggestions.push({ name, diffs });
  }

  return suggestions;
}

export function identifySlots(cluster: PatternCluster): SlotSuggestion[] {
  if (cluster.members.length < 2) return [];

  const slots: SlotSuggestion[] = [];

  // Check if text content varies across members → indicates a slot
  const repTextSlots = collectTextPositions(cluster.representative.node);

  for (const [position, repText] of repTextSlots) {
    let varyingCount = 0;
    for (const member of cluster.members) {
      const memberTexts = collectTextPositions(member.node);
      const memberText = memberTexts.get(position);
      if (memberText && memberText !== repText) {
        varyingCount++;
      }
    }

    if (varyingCount > 0) {
      const slotName = inferSlotName(position, repText);
      slots.push({
        name: slotName,
        description: `Text varies across ${varyingCount + 1} instances`,
        occurrences: varyingCount + 1,
      });
    }
  }

  return slots;
}

function collectTextPositions(node: UINode, path: string = ''): Map<string, string> {
  const result = new Map<string, string>();

  if (node.type === 'text' && node.textContent.trim()) {
    result.set(path, node.textContent.trim());
  }

  node.children.forEach((child, i) => {
    const childPath = `${path}/${child.tagName || 'text'}[${i}]`;
    for (const [k, v] of collectTextPositions(child, childPath)) {
      result.set(k, v);
    }
  });

  return result;
}

function inferSlotName(position: string, text: string): string {
  // Heuristic naming based on position and parent tags
  if (position.includes('h1') || position.includes('h2') || position.includes('h3')) return 'title';
  if (position.includes('button') || position.includes('/a[')) return 'action';
  if (position.includes('label')) return 'label';
  if (position.includes('p[')) return 'description';
  if (position.includes('span[')) return 'content';
  return 'text';
}

function findCommonClasses(cluster: PatternCluster): string[] {
  if (cluster.members.length === 0) return [];

  const classSets = cluster.members.map(m => {
    const c = m.node.classesNormalized.length > 0 ? m.node.classesNormalized : m.node.classesRaw;
    return new Set(c);
  });

  const first = classSets[0];
  const common: string[] = [];

  for (const cls of first) {
    if (classSets.every(s => s.has(cls))) {
      common.push(cls);
    }
  }

  return common.sort();
}

function pascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join('');
}
