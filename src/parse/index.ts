import type { ParseResult, SourceFile } from '../types/index.js';
import { parseHtml } from './html-parser.js';

export function parseSourceFile(file: SourceFile, raw: string): ParseResult {
  switch (file.extension) {
    case '.html':
      return parseHtml(raw, file);
    case '.jsx':
    case '.tsx':
      // Phase 2: full JSX/TSX parse with Babel
      // For now, try to extract HTML-like markup from JSX
      return parseJsxFallback(raw, file);
    default:
      return {
        source: file,
        root: null,
        diagnostics: [{ level: 'error', message: `Unsupported extension: ${file.extension}` }],
        success: false,
      };
  }
}

function parseJsxFallback(raw: string, file: SourceFile): ParseResult {
  // Heuristic: try to find the return statement's JSX and parse as HTML
  // This handles simple cases where JSX is mostly HTML-like
  const returnMatch = raw.match(/return\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*\}/);
  const jsxContent = returnMatch ? returnMatch[1] : raw;

  // Strip JSX expressions like {variable} → __DYNAMIC__
  const htmlized = jsxContent
    .replace(/\{[^}]*\}/g, '__DYNAMIC__')
    .replace(/className=/g, 'class=')
    .replace(/htmlFor=/g, 'for=');

  const result = parseHtml(htmlized, file);
  if (result.success) {
    result.diagnostics.push({
      level: 'info',
      message: 'Parsed via JSX fallback (heuristic HTML extraction)',
    });
  } else {
    result.diagnostics.push({
      level: 'warning',
      message: 'JSX fallback parse failed – file may need full Babel parser (Phase 2)',
    });
  }
  return result;
}

export { parseHtml } from './html-parser.js';
