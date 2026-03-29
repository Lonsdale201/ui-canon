import { describe, it, expect, beforeEach } from 'vitest';
import { parseHtml } from './html-parser.js';
import { parseSourceFile } from './index.js';
import type { SourceFile } from '../types/index.js';
import { resetIdCounter } from '../utils/ids.js';

const htmlFile: SourceFile = {
  fileName: 'test.html',
  relativePath: 'test.html',
  absolutePath: '/test.html',
  extension: '.html',
  screenId: 'test',
};

beforeEach(() => {
  resetIdCounter();
});

describe('parseHtml', () => {
  it('should parse a simple div', () => {
    const result = parseHtml('<div class="flex p-4">Hello</div>', htmlFile);
    expect(result.success).toBe(true);
    expect(result.root).not.toBeNull();
    expect(result.root!.tagName).toBe('div');
    expect(result.root!.classesRaw).toEqual(['flex', 'p-4']);
    expect(result.root!.children).toHaveLength(1);
    expect(result.root!.children[0].type).toBe('text');
  });

  it('should parse nested elements', () => {
    const html = `
      <header class="flex">
        <h1 class="text-xl">Title</h1>
        <button class="btn">Click</button>
      </header>
    `;
    const result = parseHtml(html, htmlFile);
    expect(result.success).toBe(true);
    expect(result.root!.tagName).toBe('header');
    expect(result.root!.children).toHaveLength(2);
    expect(result.root!.children[0].tagName).toBe('h1');
    expect(result.root!.children[1].tagName).toBe('button');
  });

  it('should handle malformed HTML gracefully', () => {
    const result = parseHtml('<div><span>unclosed', htmlFile);
    expect(result.success).toBe(true); // htmlparser2 is tolerant
    expect(result.root).not.toBeNull();
  });

  it('should create a fragment for multiple root elements', () => {
    const html = '<div>one</div><div>two</div>';
    const result = parseHtml(html, htmlFile);
    expect(result.success).toBe(true);
    expect(result.root!.type).toBe('fragment');
    expect(result.root!.children).toHaveLength(2);
  });

  it('should preserve attributes', () => {
    const html = '<input type="text" placeholder="Search" />';
    const result = parseHtml(html, htmlFile);
    expect(result.success).toBe(true);
    expect(result.root!.attributes).toEqual({ type: 'text', placeholder: 'Search' });
  });
});

describe('parseSourceFile', () => {
  it('should dispatch to HTML parser for .html files', () => {
    const result = parseSourceFile(htmlFile, '<div>test</div>');
    expect(result.success).toBe(true);
  });

  it('should handle JSX files with fallback', () => {
    const jsxFile: SourceFile = { ...htmlFile, extension: '.jsx', fileName: 'test.jsx' };
    const jsx = `
      export default function Page() {
        return (
          <div className="flex p-4">
            <h1 className="text-xl">{title}</h1>
          </div>
        );
      }
    `;
    const result = parseSourceFile(jsxFile, jsx);
    expect(result.success).toBe(true);
    expect(result.diagnostics.some(d => d.message.includes('JSX fallback'))).toBe(true);
  });
});
