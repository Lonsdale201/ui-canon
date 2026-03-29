import type { UINode, PatternCandidate, AnalyzerConfig, FamilyTag, SourceMeta } from '../types/index.js';
import { buildFingerprint } from '../fingerprint/index.js';
import { getDepth, countNodes, hasInteractiveElement, hasImageElement } from '../utils/html.js';
import { generateId } from '../utils/ids.js';

const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'head', 'html', 'body']);

// Tags that are too generic to be useful as candidate roots on their own
const TOO_GENERIC_ROOT_TAGS = new Set(['body', 'html', 'main', 'div']);
const MAX_NODE_COUNT = 500; // Skip subtrees that are basically the whole page

// Tags that should never be suppressed by ancestor deduplication.
// These are always meaningful standalone components regardless of their parent.
const NEVER_SUPPRESS_TAGS = new Set(['header']);

// Family detection rules: tag names, class patterns, ARIA roles
const FAMILY_RULES: {
  family: string;
  tags: string[];
  classPatterns: RegExp[];
  ariaRoles: string[];
}[] = [
  {
    family: 'header',
    tags: ['header'],
    classPatterns: [/header/i, /navbar/i, /top-bar/i, /topbar/i, /app-bar/i, /sticky/i, /top-0/i],
    ariaRoles: ['banner'],
  },
  {
    family: 'nav',
    tags: ['nav', 'aside'],
    classPatterns: [/sidebar/i, /sidenav/i, /nav/i, /menu/i],
    ariaRoles: ['navigation'],
  },
  {
    family: 'table',
    tags: ['table'],
    classPatterns: [/table/i, /datagrid/i, /data-grid/i],
    ariaRoles: ['grid', 'table'],
  },
  {
    family: 'modal',
    tags: ['dialog'],
    classPatterns: [/modal/i, /dialog/i, /overlay/i, /drawer/i],
    ariaRoles: ['dialog', 'alertdialog'],
  },
  {
    family: 'form-group',
    tags: ['form', 'fieldset'],
    classPatterns: [/form/i, /field/i],
    ariaRoles: ['form'],
  },
  {
    family: 'card',
    tags: [],
    classPatterns: [/card/i, /panel/i, /tile/i],
    ariaRoles: [],
  },
  {
    family: 'toolbar',
    tags: [],
    classPatterns: [/toolbar/i, /filter/i, /action-bar/i, /actionbar/i],
    ariaRoles: ['toolbar'],
  },
  {
    family: 'footer',
    tags: ['footer'],
    classPatterns: [/footer/i],
    ariaRoles: ['contentinfo'],
  },
];

/** Leaf-heaviness threshold: skip subtrees where >80% of nodes are text/leaf */
const LEAF_HEAVY_THRESHOLD = 0.8;

export function extractCandidates(
  trees: { root: UINode; source: SourceMeta }[],
  config: AnalyzerConfig,
): PatternCandidate[] {
  const rawCandidates: { node: UINode; familyTags: FamilyTag[]; source: SourceMeta }[] = [];
  const { minDepth, minNodeCount } = config.candidate;

  for (const { root, source } of trees) {
    walkTree(root, (node) => {
      if (node.type !== 'element') return;
      if (SKIP_TAGS.has(node.tagName)) return;

      const depth = getDepth(node);
      const nodeCount = countNodes(node);

      if (depth < minDepth) return;
      if (nodeCount < minNodeCount) return;
      if (nodeCount > MAX_NODE_COUNT) return; // Too large, skip whole-page subtrees

      // Skip generic divs that don't have any distinguishing classes or attributes
      if (TOO_GENERIC_ROOT_TAGS.has(node.tagName) && node.classesRaw.length === 0) return;

      // Skip leaf-heavy subtrees (>80% text/leaf nodes = just text blocks, not reusable components)
      const leafCount = countLeafNodes(node);
      if (leafCount / nodeCount > LEAF_HEAVY_THRESHOLD) return;

      const familyTags = tagCandidate(node, config);

      rawCandidates.push({ node, familyTags, source });
    });
  }

  // Ancestor deduplication: if a parent and child are both candidates, prefer the parent
  // unless the child has a different primary family tag.
  const candidateNodeSet = new Set(rawCandidates.map(c => c.node));
  const suppressedNodes = new Set<UINode>();

  for (const candidate of rawCandidates) {
    if (suppressedNodes.has(candidate.node)) continue;

    // Check if any ancestor is also a candidate
    const ancestorCandidate = findAncestorCandidate(candidate.node, candidateNodeSet, rawCandidates);
    if (ancestorCandidate) {
      const childPrimaryFamily = candidate.familyTags.length > 0 ? candidate.familyTags[0].family : null;
      const parentPrimaryFamily = ancestorCandidate.familyTags.length > 0 ? ancestorCandidate.familyTags[0].family : null;

      // Never suppress nodes with tags that are always meaningful standalone components
      if (NEVER_SUPPRESS_TAGS.has(candidate.node.tagName)) continue;

      // Only keep the child if it has a different (non-null) family tag than its ancestor
      if (!childPrimaryFamily || childPrimaryFamily === parentPrimaryFamily) {
        suppressedNodes.add(candidate.node);
      }
    }
  }

  const candidates: PatternCandidate[] = [];
  for (const { node, familyTags, source } of rawCandidates) {
    if (suppressedNodes.has(node)) continue;

    const fingerprint = buildFingerprint(node);
    candidates.push({
      id: generateId('candidate'),
      node,
      fingerprint,
      familyTags,
      source,
    });
  }

  return candidates;
}

/** Walk up the tree to find if any ancestor of `node` is in the candidate set. */
function findAncestorCandidate(
  node: UINode,
  candidateNodeSet: Set<UINode>,
  rawCandidates: { node: UINode; familyTags: FamilyTag[]; source: SourceMeta }[],
): { node: UINode; familyTags: FamilyTag[]; source: SourceMeta } | null {
  // We walk the raw candidates list to find one that is an ancestor of `node`.
  // An ancestor contains `node` as a descendant.
  for (const candidate of rawCandidates) {
    if (candidate.node === node) continue;
    if (candidateNodeSet.has(candidate.node) && isAncestorOf(candidate.node, node)) {
      return candidate;
    }
  }
  return null;
}

/** Check if `potentialAncestor` contains `target` as a descendant. */
function isAncestorOf(potentialAncestor: UINode, target: UINode): boolean {
  for (const child of potentialAncestor.children) {
    if (child === target) return true;
    if (isAncestorOf(child, target)) return true;
  }
  return false;
}

/** Count leaf nodes (text nodes and elements with no children). */
function countLeafNodes(node: UINode): number {
  if (node.type === 'text') return 1;
  if (node.children.length === 0) return 1;
  let count = 0;
  for (const child of node.children) {
    count += countLeafNodes(child);
  }
  return count;
}

export function tagCandidate(node: UINode, _config: AnalyzerConfig): FamilyTag[] {
  const tags: FamilyTag[] = [];
  const allClasses = collectAllClasses(node);
  const nodeClasses = node.classesRaw;
  const role = node.attributes['role'] || '';

  for (const rule of FAMILY_RULES) {
    let confidence = 0;

    // Tag name match
    if (rule.tags.includes(node.tagName)) {
      confidence += 0.5;
    }

    // Class pattern match
    for (const pattern of rule.classPatterns) {
      if (allClasses.some(c => pattern.test(c))) {
        confidence += 0.3;
        break;
      }
    }

    // ARIA role match
    if (rule.ariaRoles.includes(role)) {
      confidence += 0.4;
    }

    // Bonus for headers with sticky or fixed+top positioning (top app bars)
    if (rule.family === 'header') {
      const hasSticky = nodeClasses.some(c => c === 'sticky');
      const hasFixed = nodeClasses.some(c => c === 'fixed');
      const hasTop = nodeClasses.some(c => /^top-/.test(c));
      const hasFixedHeight = nodeClasses.some(c => /^h-\d+$/.test(c));
      const hasJustifyBetween = nodeClasses.some(c => c === 'justify-between');
      const hasItemsCenter = nodeClasses.some(c => c === 'items-center');
      const hasHighZ = nodeClasses.some(c => /^z-\d+$/.test(c));

      if (hasSticky || (hasFixed && hasTop)) {
        confidence += 0.2;
      }
      if (hasFixedHeight && hasJustifyBetween && hasItemsCenter) {
        confidence += 0.1;
      }
      if (hasHighZ) {
        confidence += 0.05;
      }
    }

    // Bonus for interactive elements in toolbar/form
    if ((rule.family === 'toolbar' || rule.family === 'form-group') && hasInteractiveElement(node)) {
      confidence += 0.1;
    }

    // Bonus for table having repeated row-like children
    if (rule.family === 'table' && hasRepeatedChildren(node)) {
      confidence += 0.2;
    }

    if (confidence > 0.2) {
      tags.push({ family: rule.family, confidence: Math.min(confidence, 1.0) });
    }
  }

  // Class-based heuristic rules for Tailwind/Stitch output
  // Card/panel: node has p-4/p-6/p-8 + bg-*
  const hasPadding = nodeClasses.some(c => /^p-[4-9]$|^p-[1-9]\d+$/.test(c));
  const hasBg = nodeClasses.some(c => /^bg-/.test(c));
  if (hasPadding && hasBg) {
    if (!tags.some(t => t.family === 'card')) {
      tags.push({ family: 'card', confidence: 0.5 });
    }
  }

  // Stat-card: grid or flex + stat-like children (small text + large number)
  const hasGridOrFlex = nodeClasses.some(c => c === 'grid' || c === 'flex');
  if (hasGridOrFlex && hasStatLikeChildren(node)) {
    tags.push({ family: 'stat-card', confidence: 0.6 });
  }

  // Form-group: space-y-* + label+input pairs
  const hasSpaceY = nodeClasses.some(c => /^space-y-/.test(c));
  if (hasSpaceY && hasLabelInputPairs(node)) {
    if (!tags.some(t => t.family === 'form-group')) {
      tags.push({ family: 'form-group', confidence: 0.6 });
    }
  }

  // Media-card: contains <img> + text + has flex
  const hasFlex = nodeClasses.some(c => c === 'flex');
  if (hasFlex && hasImageElement(node) && hasTextContent(node)) {
    tags.push({ family: 'media-card', confidence: 0.55 });
  }

  // Sort by confidence descending
  return tags.sort((a, b) => b.confidence - a.confidence);
}

/** Check if node has stat-like children: small text + large number patterns. */
function hasStatLikeChildren(node: UINode): boolean {
  const elementChildren = node.children.filter(c => c.type === 'element');
  if (elementChildren.length < 2) return false;

  let statLikeCount = 0;
  for (const child of elementChildren) {
    const texts = collectTextContent(child);
    // A stat-like child has a short label and a number
    const hasNumber = texts.some(t => /^\s*[\d,.$%]+\s*$/.test(t));
    const hasShortLabel = texts.some(t => t.trim().length > 0 && t.trim().length < 30 && !/^\s*[\d,.$%]+\s*$/.test(t));
    if (hasNumber && hasShortLabel) {
      statLikeCount++;
    }
  }

  return statLikeCount >= 2;
}

/** Check if node has label+input pairs among its children. */
function hasLabelInputPairs(node: UINode): boolean {
  let labelCount = 0;
  let inputCount = 0;

  walkTree(node, (n) => {
    if (n.tagName === 'label') labelCount++;
    if (n.tagName === 'input' || n.tagName === 'select' || n.tagName === 'textarea') inputCount++;
  });

  return labelCount >= 1 && inputCount >= 1;
}

/** Check if a subtree has meaningful text content. */
function hasTextContent(node: UINode): boolean {
  if (node.type === 'text' && node.textContent.trim().length > 0) return true;
  return node.children.some(hasTextContent);
}

/** Collect all text content strings from a subtree. */
function collectTextContent(node: UINode): string[] {
  const texts: string[] = [];
  if (node.type === 'text' && node.textContent.trim().length > 0) {
    texts.push(node.textContent);
  }
  for (const child of node.children) {
    texts.push(...collectTextContent(child));
  }
  return texts;
}

function collectAllClasses(node: UINode): string[] {
  const classes = [...node.classesRaw];
  for (const child of node.children) {
    classes.push(...collectAllClasses(child));
  }
  return classes;
}

function hasRepeatedChildren(node: UINode): boolean {
  if (node.children.length < 2) return false;
  const childTags = node.children
    .filter(c => c.type === 'element')
    .map(c => c.tagName);
  if (childTags.length < 2) return false;
  // Check if most children have the same tag
  const counts = new Map<string, number>();
  for (const tag of childTags) {
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  const maxCount = Math.max(...counts.values());
  return maxCount >= childTags.length * 0.6;
}

function walkTree(node: UINode, callback: (node: UINode) => void): void {
  callback(node);
  for (const child of node.children) {
    walkTree(child, callback);
  }
}
