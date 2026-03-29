/**
 * Extracts layout structure from parsed screens using Stitch comments and CSS classes.
 * Detects the high-level arrangement: sidebar, main, header, content sections.
 * Also detects layout drift across screens.
 */

import type { UINode, SourceMeta } from '../types/index.js';

export interface LayoutRegion {
  role: string;           // e.g. "sidebar", "main-content", "top-bar", "content-section"
  comment: string | null; // original Stitch comment, e.g. "SideNavBar (30% Width)"
  tag: string;
  width: string | null;   // e.g. "30%", "70%"
  position: string | null; // e.g. "fixed left-0", "sticky top-0"
  classes: string[];       // key layout classes
  children: LayoutRegion[];
}

export interface ScreenLayout {
  screenId: string;
  fileName: string;
  regions: LayoutRegion[];
}

export interface LayoutDriftIssue {
  region: string;          // e.g. "sidebar"
  property: string;        // e.g. "width", "position", "background"
  screens: { screen: string; value: string }[];
  description: string;
}

export function extractScreenLayouts(
  trees: { root: UINode; source: SourceMeta }[],
): ScreenLayout[] {
  return trees.map(({ root, source }) => ({
    screenId: source.screenId,
    fileName: source.fileName,
    regions: extractRegions(root, 0),
  }));
}

export function detectLayoutDrift(layouts: ScreenLayout[]): LayoutDriftIssue[] {
  const issues: LayoutDriftIssue[] = [];

  // Group regions by role across all screens
  const roleMap = new Map<string, { screen: string; region: LayoutRegion }[]>();

  for (const layout of layouts) {
    for (const region of flattenRegions(layout.regions)) {
      const entries = roleMap.get(region.role) || [];
      entries.push({ screen: layout.fileName, region });
      roleMap.set(region.role, entries);
    }
  }

  // Compare each role across screens
  for (const [role, entries] of roleMap) {
    if (entries.length < 2) continue;

    // Width drift
    const widths = entries.filter(e => e.region.width).map(e => ({ screen: e.screen, value: e.region.width! }));
    const uniqueWidths = new Set(widths.map(w => w.value));
    if (uniqueWidths.size > 1) {
      issues.push({
        region: role,
        property: 'width',
        screens: widths,
        description: `${role} width differs: ${[...uniqueWidths].join(' vs ')}`,
      });
    }

    // Position drift
    const positions = entries.filter(e => e.region.position).map(e => ({ screen: e.screen, value: e.region.position! }));
    const uniquePositions = new Set(positions.map(p => p.value));
    if (uniquePositions.size > 1) {
      issues.push({
        region: role,
        property: 'position',
        screens: positions,
        description: `${role} position differs: ${[...uniquePositions].join(' vs ')}`,
      });
    }

    // Background drift
    const bgs = entries.map(e => {
      const bg = e.region.classes.filter(c => c.startsWith('bg-')).sort().join(' ');
      return { screen: e.screen, value: bg || '(none)' };
    });
    const uniqueBgs = new Set(bgs.map(b => b.value));
    if (uniqueBgs.size > 1) {
      issues.push({
        region: role,
        property: 'background',
        screens: bgs,
        description: `${role} background differs: ${[...uniqueBgs].join(' vs ')}`,
      });
    }
  }

  return issues;
}

function extractRegions(node: UINode, depth: number): LayoutRegion[] {
  // Only look at top-level structural elements (first 2-3 levels)
  if (depth > 3) return [];
  if (node.type !== 'element' && node.type !== 'fragment') return [];

  const regions: LayoutRegion[] = [];

  for (const child of node.children) {
    if (child.type !== 'element') continue;

    const role = inferRole(child);
    if (role) {
      regions.push({
        role,
        comment: (child.meta.comment as string) || null,
        tag: child.tagName,
        width: extractWidth(child.classesRaw),
        position: extractPosition(child.classesRaw),
        classes: extractLayoutClasses(child.classesRaw),
        children: extractRegions(child, depth + 1),
      });
    } else if (depth < 2) {
      // Recurse into generic containers to find layout regions
      regions.push(...extractRegions(child, depth + 1));
    }
  }

  return regions;
}

function inferRole(node: UINode): string | null {
  const comment = ((node.meta.comment as string) || '').toLowerCase();
  const classes = node.classesRaw.join(' ').toLowerCase();
  const tag = node.tagName;

  // Comment-based detection (Stitch comments are the most reliable)
  if (comment.includes('sidenav') || comment.includes('sidebar')) return 'sidebar';
  if (comment.includes('topappbar') || comment.includes('topnavbar') || comment.includes('top app bar')) return 'top-bar';
  if (comment.includes('main content')) return 'main-content';
  if (comment.includes('statistics') || comment.includes('stats')) return 'stats-grid';
  if (comment.includes('table') || comment.includes('rentals list') || comment.includes('client list')) return 'data-list';
  if (comment.includes('contacts')) return 'contacts-list';
  if (comment.includes('quick links') || comment.includes('critical operations')) return 'action-grid';
  if (comment.includes('form') || comment.includes('registration')) return 'form-section';
  if (comment.includes('footer')) return 'footer';
  if (comment.includes('catalog')) return 'catalog-grid';

  // Tag-based detection
  if (tag === 'aside') return 'sidebar';
  if (tag === 'header') return 'top-bar';
  if (tag === 'main') return 'main-content';
  if (tag === 'nav') return 'navigation';
  if (tag === 'footer') return 'footer';

  // Class-based detection for structural elements
  if (tag === 'div' || tag === 'section') {
    if (classes.includes('fixed') && classes.includes('left-0') && /w-\[/.test(classes)) return 'sidebar';
    if (classes.includes('sticky') && classes.includes('top-0')) return 'top-bar';
    if (/ml-\[/.test(classes) && /w-\[/.test(classes)) return 'main-content';
    if (classes.includes('grid') && classes.includes('grid-cols-12')) return 'content-grid';
    if (classes.includes('grid') && classes.includes('gap-')) return 'content-grid';
  }

  return null;
}

function extractWidth(classes: string[]): string | null {
  for (const cls of classes) {
    // w-[30%], w-[70%], etc.
    const match = cls.match(/^w-\[(\d+%?)\]$/);
    if (match) return match[1];
    // w-full, w-1/2, etc.
    if (cls === 'w-full') return '100%';
    if (cls === 'w-1/2') return '50%';
    if (cls === 'w-1/3') return '33%';
    if (cls === 'w-2/3') return '67%';
    // col-span-*
    const colMatch = cls.match(/^col-span-(\d+)$/);
    if (colMatch) return `${colMatch[1]}/12 cols`;
  }
  return null;
}

function extractPosition(classes: string[]): string | null {
  const posClasses = classes.filter(c =>
    c === 'fixed' || c === 'sticky' || c === 'absolute' || c === 'relative' ||
    c.startsWith('top-') || c.startsWith('left-') || c.startsWith('right-') || c.startsWith('bottom-')
  );
  return posClasses.length > 0 ? posClasses.join(' ') : null;
}

function extractLayoutClasses(classes: string[]): string[] {
  return classes.filter(c =>
    c.startsWith('w-') || c.startsWith('h-') || c.startsWith('ml-') || c.startsWith('mr-') ||
    c.startsWith('flex') || c.startsWith('grid') || c.startsWith('col-') ||
    c.startsWith('gap-') || c.startsWith('space-') ||
    c === 'fixed' || c === 'sticky' || c === 'absolute' || c === 'relative' ||
    c.startsWith('top-') || c.startsWith('left-') || c.startsWith('right-') || c.startsWith('bottom-') ||
    c.startsWith('overflow-') || c.startsWith('z-') ||
    c.startsWith('bg-') || c.startsWith('p-') || c.startsWith('px-') || c.startsWith('py-')
  );
}

function flattenRegions(regions: LayoutRegion[]): LayoutRegion[] {
  const flat: LayoutRegion[] = [];
  for (const r of regions) {
    flat.push(r);
    flat.push(...flattenRegions(r.children));
  }
  return flat;
}
