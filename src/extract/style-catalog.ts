/**
 * Extracts a catalog of recurring micro-styles: buttons, badges, inputs, text styles.
 * Instead of just saying "there's drift", this tells the AI:
 * "here are the 3 button styles you should use."
 */

import type { UINode } from '../types/index.js';

export interface StyleEntry {
  classes: string[];
  tag: string;
  occurrences: number;
  foundIn: string[];
  sampleText: string;
}

export interface StyleCatalog {
  buttons: StyleEntry[];
  badges: StyleEntry[];
  inputs: StyleEntry[];
  headings: StyleEntry[];
}

export function buildStyleCatalog(
  trees: { root: UINode; screenId: string }[],
): StyleCatalog {
  const buttonMap = new Map<string, StyleEntry>();
  const badgeMap = new Map<string, StyleEntry>();
  const inputMap = new Map<string, StyleEntry>();
  const headingMap = new Map<string, StyleEntry>();

  for (const { root, screenId } of trees) {
    walkTree(root, (node) => {
      // Buttons
      if (node.tagName === 'button' || (node.tagName === 'a' && hasActionClasses(node))) {
        collectStyle(buttonMap, node, screenId);
      }

      // Badges/status tags (inline-block spans with bg + small text)
      if (isBadge(node)) {
        collectStyle(badgeMap, node, screenId);
      }

      // Inputs
      if (node.tagName === 'input' || node.tagName === 'select' || node.tagName === 'textarea') {
        collectStyle(inputMap, node, screenId);
      }

      // Headings
      if (/^h[1-6]$/.test(node.tagName)) {
        collectStyle(headingMap, node, screenId);
      }
    });
  }

  return {
    buttons: dedup(buttonMap),
    badges: dedup(badgeMap),
    inputs: dedup(inputMap),
    headings: dedup(headingMap),
  };
}

function collectStyle(
  map: Map<string, StyleEntry>,
  node: UINode,
  screenId: string,
): void {
  const classes = node.classesNormalized.length > 0
    ? node.classesNormalized
    : node.classesRaw;

  if (classes.length === 0) return;

  // Key = sorted visual classes only (strip hover/focus/transition)
  const visualClasses = classes.filter(c =>
    !c.startsWith('hover:') && !c.startsWith('focus:') &&
    !c.startsWith('active:') && !c.startsWith('group-hover:') &&
    !c.includes('transition') && !c.includes('duration') &&
    !c.includes('cursor')
  ).sort();

  if (visualClasses.length === 0) return;

  const key = visualClasses.join(' ');
  const existing = map.get(key);

  const sampleText = extractSampleText(node);

  if (existing) {
    existing.occurrences++;
    if (!existing.foundIn.includes(screenId)) {
      existing.foundIn.push(screenId);
    }
  } else {
    map.set(key, {
      classes: visualClasses,
      tag: node.tagName,
      occurrences: 1,
      foundIn: [screenId],
      sampleText,
    });
  }
}

function isBadge(node: UINode): boolean {
  if (node.tagName !== 'span') return false;
  const cls = node.classesRaw.join(' ');
  // Inline badge pattern: inline-block + px + py + bg + small text
  const hasInline = cls.includes('inline-block') || cls.includes('inline-flex');
  const hasPadding = /px-\d/.test(cls) && /py-\d/.test(cls);
  const hasBg = /bg-/.test(cls);
  const hasSmallText = /text-\[?(9|10|11|xs)/.test(cls);
  return (hasInline || hasPadding) && hasBg && hasSmallText;
}

function hasActionClasses(node: UINode): boolean {
  const cls = node.classesRaw.join(' ');
  return (cls.includes('bg-') && cls.includes('px-')) || cls.includes('btn');
}

function extractSampleText(node: UINode): string {
  if (node.type === 'text' && node.textContent.trim()) {
    return node.textContent.trim().substring(0, 50);
  }
  for (const child of node.children) {
    const text = extractSampleText(child);
    if (text) return text;
  }
  return '';
}

function dedup(map: Map<string, StyleEntry>): StyleEntry[] {
  return [...map.values()]
    .sort((a, b) => b.occurrences - a.occurrences);
}

function walkTree(node: UINode, callback: (node: UINode) => void): void {
  callback(node);
  for (const child of node.children) {
    walkTree(child, callback);
  }
}
