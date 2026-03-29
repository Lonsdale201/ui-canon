import { describe, it, expect } from 'vitest';
import { normalizeClasses, normalizeAttributes, abstractText, normalizeTree } from './index.js';
import type { UINode, SourceMeta } from '../types/index.js';

const dummySource: SourceMeta = {
  fileName: 'test.html',
  relativePath: 'test.html',
  extension: '.html',
  screenId: 'test',
};

function makeNode(overrides: Partial<UINode> = {}): UINode {
  return {
    id: 'n1',
    type: 'element',
    tagName: 'div',
    attributes: {},
    classesRaw: [],
    classesNormalized: [],
    textContent: '',
    children: [],
    source: dummySource,
    meta: {},
    ...overrides,
  };
}

describe('normalizeClasses', () => {
  it('should sort classes alphabetically', () => {
    expect(normalizeClasses(['px-4', 'flex', 'bg-white'])).toEqual(['bg-white', 'flex', 'px-4']);
  });

  it('should deduplicate classes', () => {
    expect(normalizeClasses(['flex', 'flex', 'p-4', 'p-4'])).toEqual(['flex', 'p-4']);
  });

  it('should handle empty list', () => {
    expect(normalizeClasses([])).toEqual([]);
  });

  it('should handle responsive prefixes', () => {
    expect(normalizeClasses(['md:flex', 'flex', 'lg:hidden'])).toEqual(['flex', 'lg:hidden', 'md:flex']);
  });
});

describe('normalizeAttributes', () => {
  it('should strip id attributes', () => {
    expect(normalizeAttributes({ id: 'random-123', href: '/test' })).toEqual({ href: '/test' });
  });

  it('should strip data-testid', () => {
    expect(normalizeAttributes({ 'data-testid': 'btn', type: 'button' })).toEqual({ type: 'button' });
  });

  it('should keep relevant attributes', () => {
    expect(normalizeAttributes({ href: '/link', role: 'button', type: 'submit' }))
      .toEqual({ href: '/link', role: 'button', type: 'submit' });
  });
});

describe('abstractText', () => {
  it('should replace text content with placeholder', () => {
    const node = makeNode({ type: 'text', textContent: 'Hello World' });
    const result = abstractText(node);
    expect(result.textContent).toBe('__ACTION_TEXT__');
    expect(result.meta.originalText).toBe('Hello World');
  });

  it('should use __TEXT__ for longer text', () => {
    const node = makeNode({
      type: 'text',
      textContent: 'This is a very long paragraph that describes something in detail for the user.',
    });
    const result = abstractText(node);
    expect(result.textContent).toBe('__TEXT__');
  });

  it('should recurse into children', () => {
    const node = makeNode({
      children: [
        makeNode({ type: 'text', textContent: 'Click me', id: 'c1' }),
      ],
    });
    const result = abstractText(node);
    expect(result.children[0].textContent).toBe('__ACTION_TEXT__');
  });
});

describe('normalizeTree', () => {
  it('should normalize classes on all nodes', () => {
    const node = makeNode({
      classesRaw: ['px-4', 'flex', 'bg-white'],
      children: [
        makeNode({ classesRaw: ['text-sm', 'font-bold'], id: 'c1' }),
      ],
    });
    const result = normalizeTree(node);
    expect(result.classesNormalized).toEqual(['bg-white', 'flex', 'px-4']);
    expect(result.children[0].classesNormalized).toEqual(['font-bold', 'text-sm']);
  });
});
