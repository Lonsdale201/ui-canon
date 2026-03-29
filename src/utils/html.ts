import type { UINode } from '../types/index.js';

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

export function serializeNode(node: UINode, indent: number = 0): string {
  const pad = ' '.repeat(indent);

  if (node.type === 'text') {
    return `${pad}${node.textContent}`;
  }

  if (node.type === 'fragment') {
    return node.children.map(child => serializeNode(child, indent)).join('\n');
  }

  const tag = node.tagName || 'div';
  const classes = node.classesNormalized.length > 0
    ? node.classesNormalized
    : node.classesRaw;

  const attrs: string[] = [];
  if (classes.length > 0) {
    attrs.push(`class="${classes.join(' ')}"`);
  }
  for (const [key, value] of Object.entries(node.attributes)) {
    if (key === 'class') continue;
    attrs.push(`${key}="${value}"`);
  }

  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

  if (VOID_ELEMENTS.has(tag)) {
    return `${pad}<${tag}${attrStr} />`;
  }

  if (node.children.length === 0) {
    return `${pad}<${tag}${attrStr}></${tag}>`;
  }

  const children = node.children.map(child => serializeNode(child, indent + 2)).join('\n');
  return `${pad}<${tag}${attrStr}>\n${children}\n${pad}</${tag}>`;
}

export function countNodes(node: UINode): number {
  let count = 1;
  for (const child of node.children) {
    count += countNodes(child);
  }
  return count;
}

export function getDepth(node: UINode): number {
  if (node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(getDepth));
}

const INTERACTIVE_TAGS = new Set(['button', 'input', 'select', 'textarea', 'a']);

export function hasInteractiveElement(node: UINode): boolean {
  if (INTERACTIVE_TAGS.has(node.tagName)) return true;
  return node.children.some(hasInteractiveElement);
}

export function countInteractive(node: UINode): number {
  let count = INTERACTIVE_TAGS.has(node.tagName) ? 1 : 0;
  for (const child of node.children) {
    count += countInteractive(child);
  }
  return count;
}

export function countTextSlots(node: UINode): number {
  if (node.type === 'text' && node.textContent.trim().length > 0) return 1;
  let count = 0;
  for (const child of node.children) {
    count += countTextSlots(child);
  }
  return count;
}

export function hasImageElement(node: UINode): boolean {
  if (node.tagName === 'img' || node.tagName === 'svg') return true;
  return node.children.some(hasImageElement);
}
