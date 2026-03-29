import type { UINode } from '../types/index.js';

// Attributes to strip during normalization (generated/random IDs, data attrs, etc.)
const STRIP_ATTRIBUTES = new Set([
  'id', 'data-testid', 'data-id', 'data-reactid', 'data-v-', 'key',
]);

const STRIP_ATTRIBUTE_PREFIXES = ['data-v-', 'data-testid', 'data-reactid'];

export interface NormalizeOptions {
  abstractText?: boolean;
  stripWrappers?: boolean;
}

export function normalizeTree(root: UINode, options: NormalizeOptions = {}): UINode {
  let node = normalizeNode(root);
  if (options.abstractText) {
    node = abstractText(node);
  }
  if (options.stripWrappers) {
    node = stripWrappers(node);
  }
  return node;
}

function normalizeNode(node: UINode): UINode {
  const classesNormalized = normalizeClasses(node.classesRaw);
  const attributes = normalizeAttributes(node.attributes);
  const children = node.children.map(normalizeNode);

  return {
    ...node,
    classesNormalized,
    attributes,
    children,
  };
}

export function normalizeClasses(classList: string[]): string[] {
  // Deduplicate
  const unique = [...new Set(classList)];
  // Alphabetical sort (MVP – not full Tailwind-aware sort)
  return unique.sort();
}

export function normalizeAttributes(
  attrs: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(attrs)) {
    // Skip known irrelevant attributes
    if (STRIP_ATTRIBUTES.has(key)) continue;
    if (STRIP_ATTRIBUTE_PREFIXES.some(p => key.startsWith(p))) continue;
    // Skip generated-looking IDs (hex, uuid patterns)
    if (key === 'id' && /^[a-f0-9-]{8,}$/i.test(value)) continue;

    result[key] = value;
  }

  return result;
}

export function abstractText(node: UINode): UINode {
  if (node.type === 'text') {
    const text = node.textContent.trim();
    if (text.length === 0) return node;

    // Classify text type
    let placeholder = '__TEXT__';
    // Short text in a button or link context
    if (text.length <= 30) {
      placeholder = '__ACTION_TEXT__';
    }

    return { ...node, textContent: placeholder, meta: { ...node.meta, originalText: text } };
  }

  return {
    ...node,
    children: node.children.map(abstractText),
  };
}

export function stripWrappers(node: UINode): UINode {
  // If a div has no classes, no attributes, and exactly one child element, unwrap it
  if (
    node.type === 'element' &&
    node.tagName === 'div' &&
    node.classesRaw.length === 0 &&
    Object.keys(node.attributes).length === 0 &&
    node.children.length === 1 &&
    node.children[0].type === 'element'
  ) {
    return stripWrappers(node.children[0]);
  }

  return {
    ...node,
    children: node.children.map(stripWrappers),
  };
}
