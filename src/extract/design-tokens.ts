/**
 * Extracts design tokens (colors, fonts, radii, custom CSS) from Stitch HTML files.
 * These are typically embedded in <script id="tailwind-config"> and <style> tags.
 */

export interface DesignTokens {
  colors: Record<string, string>;
  fontFamily: Record<string, string[]>;
  borderRadius: Record<string, string>;
  customCss: string[];
  fontImports: string[];
  iconSystem: string | null;
}

export function extractDesignTokens(rawHtmlFiles: { fileName: string; content: string }[]): DesignTokens {
  const merged: DesignTokens = {
    colors: {},
    fontFamily: {},
    borderRadius: {},
    customCss: [],
    fontImports: [],
    iconSystem: null,
  };

  const seenCss = new Set<string>();
  const seenFontImports = new Set<string>();

  for (const { content } of rawHtmlFiles) {
    // Extract tailwind config
    const configMatch = content.match(/tailwind\.config\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
    if (configMatch) {
      try {
        const configStr = configMatch[1]
          // Make it valid JSON-ish: add quotes to keys
          .replace(/(\w+)\s*:/g, '"$1":')
          // Fix trailing commas
          .replace(/,\s*([}\]])/g, '$1')
          // Fix double-quoted keys that got re-quoted
          .replace(/""+/g, '"');

        // Simpler approach: just extract the parts we need with regex
        extractColorsFromConfig(content, merged);
        extractFontFamilyFromConfig(content, merged);
        extractBorderRadiusFromConfig(content, merged);
      } catch {
        // Fallback to regex extraction
        extractColorsFromConfig(content, merged);
        extractFontFamilyFromConfig(content, merged);
        extractBorderRadiusFromConfig(content, merged);
      }
    }

    // Extract custom CSS from <style> tags (deduplicate at rule level)
    const styleMatches = content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g);
    for (const match of styleMatches) {
      const css = match[1].trim();
      if (css) {
        const customRules = extractCustomCssRules(css);
        for (const rule of customRules) {
          if (!seenCss.has(rule)) {
            seenCss.add(rule);
            merged.customCss.push(rule);
          }
        }
      }
    }

    // Extract Google Font imports
    const fontLinkMatches = content.matchAll(/href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/g);
    for (const match of fontLinkMatches) {
      const url = match[1];
      if (!seenFontImports.has(url)) {
        seenFontImports.add(url);
        merged.fontImports.push(url);
      }
    }

    // Detect icon system
    if (content.includes('material-symbols-outlined') || content.includes('Material+Symbols')) {
      merged.iconSystem = 'material-symbols-outlined';
    }
  }

  return merged;
}

function extractColorsFromConfig(html: string, tokens: DesignTokens): void {
  // Match "color-name": "#hexval" patterns inside the config
  const colorRegex = /"([a-z][a-z0-9-]+)"\s*:\s*"(#[0-9a-fA-F]{3,8})"/g;
  let match;
  while ((match = colorRegex.exec(html)) !== null) {
    const [, name, value] = match;
    tokens.colors[name] = value;
  }
}

function extractFontFamilyFromConfig(html: string, tokens: DesignTokens): void {
  // Match "family-name": ["FontName"] patterns
  const fontRegex = /"([a-z][a-z0-9-]+)"\s*:\s*\["([^"]+)"\]/g;
  let match;
  while ((match = fontRegex.exec(html)) !== null) {
    const [, name, font] = match;
    // Only capture font family definitions (not color or other string arrays)
    if (/^[A-Z]/.test(font)) {
      tokens.fontFamily[name] = [font];
    }
  }
}

function extractBorderRadiusFromConfig(html: string, tokens: DesignTokens): void {
  // Look for borderRadius section
  const radiusBlock = html.match(/borderRadius\s*:\s*\{([^}]+)\}/);
  if (radiusBlock) {
    const entries = radiusBlock[1].matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g);
    for (const entry of entries) {
      tokens.borderRadius[entry[1]] = entry[2];
    }
  }
}

function extractCustomCssRules(css: string): string[] {
  const rules: string[] = [];

  // Split by rule blocks
  const ruleMatches = css.matchAll(/([.#][a-zA-Z][\w-]*(?:\s*,\s*[.#]?[a-zA-Z][\w-]*)*)\s*\{([^}]+)\}/g);
  for (const match of ruleMatches) {
    const selector = match[1].trim();
    const body = match[2].trim();

    // Skip browser-specific pseudo selectors
    if (selector.includes('::-webkit-')) continue;

    // Keep meaningful custom rules
    if (body.length > 0) {
      rules.push(`${selector} { ${body.replace(/\s+/g, ' ')} }`);
    }
  }

  // Also capture element rules like "body { ... }" and "h1, h2, h3 { ... }"
  const elementRules = css.matchAll(/((?:body|h[1-6])(?:\s*,\s*(?:h[1-6]|\.[\w-]+))*)\s*\{([^}]+)\}/g);
  for (const match of elementRules) {
    const selector = match[1].trim();
    const body = match[2].trim();
    if (body.length > 0) {
      rules.push(`${selector} { ${body.replace(/\s+/g, ' ')} }`);
    }
  }

  return [...new Set(rules)];
}
