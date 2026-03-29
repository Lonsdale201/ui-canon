import { Parser, DomHandler } from 'htmlparser2';
import type { ParseResult, SourceFile, UINode, SourceMeta, ParseDiagnostic } from '../types/index.js';
import { generateId } from '../utils/ids.js';

export function parseHtml(raw: string, file: SourceFile): ParseResult {
  const diagnostics: ParseDiagnostic[] = [];
  const source: SourceMeta = {
    fileName: file.fileName,
    relativePath: file.relativePath,
    extension: file.extension,
    screenId: file.screenId,
  };

  try {
    const handler = new DomHandler(undefined, {
      withStartIndices: true,
      withEndIndices: true,
    });

    const parser = new Parser(handler, {
      recognizeSelfClosing: true,
      lowerCaseTags: true,
      lowerCaseAttributeNames: true,
    });

    parser.write(raw);
    parser.end();

    const dom = handler.dom;
    const children = dom
      .filter(n => n.type === 'tag' || n.type === 'text')
      .map(n => domNodeToUINode(n, source));

    // If there's a single root element, use it directly
    let root: UINode;
    const elementChildren = children.filter(c => c.type === 'element');
    if (elementChildren.length === 1) {
      root = elementChildren[0];
    } else {
      root = {
        id: generateId('fragment'),
        type: 'fragment',
        tagName: '',
        attributes: {},
        classesRaw: [],
        classesNormalized: [],
        textContent: '',
        children,
        source,
        meta: {},
      };
    }

    return { source: file, root, diagnostics, success: true };
  } catch (err) {
    diagnostics.push({
      level: 'error',
      message: `HTML parse error: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { source: file, root: null, diagnostics, success: false };
  }
}

function domNodeToUINode(node: any, source: SourceMeta): UINode {
  if (node.type === 'text') {
    const text = node.data?.trim() ?? '';
    return {
      id: generateId('text'),
      type: 'text',
      tagName: '',
      attributes: {},
      classesRaw: [],
      classesNormalized: [],
      textContent: text,
      children: [],
      source,
      meta: {},
    };
  }

  const tagName = (node.name || '').toLowerCase();
  const attribs: Record<string, string> = node.attribs || {};
  const classAttr = attribs['class'] || '';
  const classesRaw = classAttr
    ? classAttr.split(/\s+/).filter((c: string) => c.length > 0)
    : [];

  // Skip class from attributes since we track it separately
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(attribs)) {
    if (key !== 'class') {
      attributes[key] = value as string;
    }
  }

  // Process children, preserving comments as meta on the next sibling element
  const rawChildren = node.children || [];
  const children: UINode[] = [];
  let pendingComment: string | null = null;

  for (const c of rawChildren) {
    if (c.type === 'comment') {
      const text = (c.data || '').trim();
      if (text) pendingComment = text;
      continue;
    }
    if (c.type === 'tag') {
      const child = domNodeToUINode(c, source);
      if (pendingComment) {
        child.meta.comment = pendingComment;
        pendingComment = null;
      }
      children.push(child);
    } else if (c.type === 'text' && c.data?.trim()) {
      children.push(domNodeToUINode(c, source));
      pendingComment = null;
    }
  }

  // Check if this looks like a component (PascalCase tag)
  const isComponentLike = /^[A-Z]/.test(node.name || '');

  return {
    id: generateId('node'),
    type: isComponentLike ? 'componentLike' : 'element',
    tagName,
    attributes,
    classesRaw,
    classesNormalized: [],
    textContent: '',
    children,
    source,
    loc: node.startIndex != null ? { line: 0, column: node.startIndex } : undefined,
    meta: {},
  };
}
