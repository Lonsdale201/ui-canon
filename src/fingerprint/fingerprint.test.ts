import { describe, it, expect, beforeEach } from 'vitest';
import { buildFingerprint, buildStructuralHash } from './index.js';
import type { UINode, SourceMeta } from '../types/index.js';
import { resetIdCounter } from '../utils/ids.js';

const source: SourceMeta = {
  fileName: 'test.html', relativePath: 'test.html', extension: '.html', screenId: 'test',
};

function makeNode(tag: string, classes: string[] = [], children: UINode[] = []): UINode {
  return {
    id: `n-${tag}`, type: 'element', tagName: tag,
    attributes: {}, classesRaw: classes, classesNormalized: classes,
    textContent: '', children, source, meta: {},
  };
}

function makeText(text: string): UINode {
  return {
    id: `t-${text}`, type: 'text', tagName: '',
    attributes: {}, classesRaw: [], classesNormalized: [],
    textContent: text, children: [], source, meta: {},
  };
}

beforeEach(() => resetIdCounter());

describe('buildStructuralHash', () => {
  it('should produce same hash for same structure', () => {
    const a = makeNode('div', [], [makeNode('h1'), makeNode('p')]);
    const b = makeNode('div', [], [makeNode('h1'), makeNode('p')]);
    expect(buildStructuralHash(a)).toBe(buildStructuralHash(b));
  });

  it('should produce different hash for different structure', () => {
    const a = makeNode('div', [], [makeNode('h1'), makeNode('p')]);
    const b = makeNode('div', [], [makeNode('h2'), makeNode('p')]);
    expect(buildStructuralHash(a)).not.toBe(buildStructuralHash(b));
  });
});

describe('buildFingerprint', () => {
  it('should create fingerprint with shape descriptor', () => {
    const node = makeNode('div', ['flex', 'p-4'], [
      makeNode('h1', ['text-xl'], [makeText('Title')]),
      makeNode('button', ['btn'], [makeText('Click')]),
    ]);
    const fp = buildFingerprint(node);
    expect(fp.shape.depth).toBe(2);
    expect(fp.shape.hasInteractive).toBe(true);
    expect(fp.shape.hasText).toBe(true);
    expect(fp.shape.interactiveCount).toBe(1);
  });

  it('should produce same exact hash for identical nodes', () => {
    const a = makeNode('div', ['flex'], [makeNode('span', ['text-sm'])]);
    const b = makeNode('div', ['flex'], [makeNode('span', ['text-sm'])]);
    expect(buildFingerprint(a).exact).toBe(buildFingerprint(b).exact);
  });

  it('should produce different exact hash when classes differ', () => {
    const a = makeNode('div', ['flex'], [makeNode('span', ['text-sm'])]);
    const b = makeNode('div', ['flex'], [makeNode('span', ['text-lg'])]);
    expect(buildFingerprint(a).exact).not.toBe(buildFingerprint(b).exact);
  });
});
