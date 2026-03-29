import { createHash } from 'node:crypto';
import type { UINode, NodeFingerprint, ShapeDescriptor } from '../types/index.js';
import { getDepth, countNodes, countInteractive, countTextSlots, hasInteractiveElement, hasImageElement } from '../utils/html.js';

export function buildFingerprint(node: UINode): NodeFingerprint {
  const structural = buildStructuralHash(node);
  const classSignature = buildClassSignature(node);
  const shape = buildShapeDescriptor(node);

  // Exact hash: structural + all actual classes (not just categories) + attributes
  const allClasses = collectAllClasses(node).sort().join(',');
  const exactInput = structural + '|' + allClasses + '|' + serializeAttributes(node);
  const exact = hash(exactInput);

  return {
    exact,
    structural: hash(structural),
    classSignature: [...classSignature].sort(),
    shape,
  };
}

export function buildStructuralHash(node: UINode): string {
  if (node.type === 'text') return '#text';
  if (node.type === 'fragment') {
    return node.children.map(buildStructuralHash).join('+');
  }

  const tag = node.tagName || '_';
  if (node.children.length === 0) return tag;

  const childHashes = node.children.map(buildStructuralHash);
  return `${tag}>${childHashes.join('+')}`;
}

export function buildClassSignature(node: UINode): Set<string> {
  const sig = new Set<string>();

  const classes = node.classesNormalized.length > 0
    ? node.classesNormalized
    : node.classesRaw;

  for (const cls of classes) {
    // Extract Tailwind utility category (e.g., "text" from "text-lg", "bg" from "bg-blue-500")
    const category = extractUtilityCategory(cls);
    sig.add(category);
  }

  for (const child of node.children) {
    for (const s of buildClassSignature(child)) {
      sig.add(s);
    }
  }

  return sig;
}

function extractUtilityCategory(cls: string): string {
  // Strip responsive/state prefixes (md:, hover:, etc.)
  const stripped = cls.replace(/^[a-z]+:/g, '');
  // Get the first part before a dash as category
  const dash = stripped.indexOf('-');
  if (dash === -1) return stripped;
  return stripped.substring(0, dash);
}

export function buildShapeDescriptor(node: UINode): ShapeDescriptor {
  return {
    depth: getDepth(node),
    childCount: node.children.length,
    nodeCount: countNodes(node),
    hasInteractive: hasInteractiveElement(node),
    hasText: countTextSlots(node) > 0,
    hasImage: hasImageElement(node),
    interactiveCount: countInteractive(node),
    textSlotCount: countTextSlots(node),
  };
}

export function serializeFingerprint(fp: NodeFingerprint): string {
  return `${fp.structural}|${fp.classSignature.join(',')}|${JSON.stringify(fp.shape)}`;
}

function serializeAttributes(node: UINode): string {
  const parts: string[] = [];
  const keys = Object.keys(node.attributes).sort();
  for (const k of keys) {
    parts.push(`${k}=${node.attributes[k]}`);
  }
  for (const child of node.children) {
    parts.push(serializeAttributes(child));
  }
  return parts.join(';');
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

function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex').substring(0, 16);
}
