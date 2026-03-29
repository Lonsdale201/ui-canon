/**
 * Extracts design tokens (colors, fonts, radii, custom CSS) from Stitch HTML files.
 * These are typically embedded in <script id="tailwind-config"> and <style> tags.
 */

export interface CssConflict {
  selector: string;
  property: string;
  values: string[];
  resolved: string;
  reason: string;
}

export interface DesignTokens {
  colors: Record<string, string>;
  fontFamily: Record<string, string[]>;
  borderRadius: Record<string, string>;
  customCss: string[];
  fontImports: string[];
  iconSystem: string | null;
  aliases: Record<string, string>;
  cssConflicts: CssConflict[];
}

export function extractDesignTokens(rawHtmlFiles: { fileName: string; content: string }[]): DesignTokens {
  const merged: DesignTokens = {
    colors: {},
    fontFamily: {},
    borderRadius: {},
    customCss: [],
    fontImports: [],
    iconSystem: null,
    aliases: {},
    cssConflicts: [],
  };

  // Collect all CSS rules with counts for conflict resolution and alias detection
  // key: "selector|||property" -> value -> count
  const ruleCounts: Map<string, Map<string, number>> = new Map();
  // key: normalized body -> selector[]
  const bodyToSelectors: Map<string, string[]> = new Map();
  const allRawFontImports: string[] = [];

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

    // Extract custom CSS from <style> tags - collect all rules for conflict resolution
    const styleMatches = content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g);
    for (const match of styleMatches) {
      const css = match[1].trim();
      if (css) {
        const customRules = extractCustomCssRules(css);
        for (const rule of customRules) {
          // Parse selector and body from the rule
          const ruleMatch = rule.match(/^(.+?)\s*\{\s*(.*?)\s*\}$/);
          if (!ruleMatch) continue;
          const selector = ruleMatch[1].trim();
          const body = ruleMatch[2].trim();

          // Track body -> selectors for alias detection
          const normalizedBody = body.replace(/\s+/g, ' ').toLowerCase();
          if (!bodyToSelectors.has(normalizedBody)) {
            bodyToSelectors.set(normalizedBody, []);
          }
          const selectors = bodyToSelectors.get(normalizedBody)!;
          selectors.push(selector);

          // Track per-property values for conflict resolution
          const properties = body.split(';').filter(p => p.trim());
          for (const prop of properties) {
            const colonIdx = prop.indexOf(':');
            if (colonIdx === -1) continue;
            const propName = prop.substring(0, colonIdx).trim();
            const propValue = prop.substring(colonIdx + 1).trim();
            const key = `${selector}|||${propName}`;
            if (!ruleCounts.has(key)) {
              ruleCounts.set(key, new Map());
            }
            const valueCounts = ruleCounts.get(key)!;
            valueCounts.set(propValue, (valueCounts.get(propValue) || 0) + 1);
          }
        }
      }
    }

    // Extract Google Font imports - collect all for later merging
    const fontLinkMatches = content.matchAll(/href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/g);
    for (const match of fontLinkMatches) {
      allRawFontImports.push(match[1]);
    }

    // Detect icon system
    if (content.includes('material-symbols-outlined') || content.includes('Material+Symbols')) {
      merged.iconSystem = 'material-symbols-outlined';
    }
  }

  // --- CSS Conflict Resolution ---
  resolveConflicts(ruleCounts, merged);

  // --- Alias Detection ---
  detectAliases(bodyToSelectors, merged);

  // --- Font Import Merge ---
  merged.fontImports = mergeFontImports(allRawFontImports);

  return merged;
}

// ─── Conflict Resolution ───

function resolveConflicts(
  ruleCounts: Map<string, Map<string, number>>,
  tokens: DesignTokens,
): void {
  const resolvedRules: Map<string, string[]> = new Map(); // selector -> resolved properties

  for (const [key, valueCounts] of ruleCounts) {
    const [selector, propName] = key.split('|||');
    const values = [...valueCounts.keys()];

    if (values.length > 1) {
      // Conflict detected - resolve by majority vote
      let maxCount = 0;
      let resolved = values[0];
      for (const [value, count] of valueCounts) {
        if (count > maxCount) {
          maxCount = count;
          resolved = value;
        }
      }
      tokens.cssConflicts.push({
        selector,
        property: propName,
        values,
        resolved,
        reason: `majority vote (${maxCount} occurrences)`,
      });
      if (!resolvedRules.has(selector)) resolvedRules.set(selector, []);
      resolvedRules.get(selector)!.push(`${propName}: ${resolved}`);
    } else {
      // No conflict, keep as-is
      if (!resolvedRules.has(selector)) resolvedRules.set(selector, []);
      resolvedRules.get(selector)!.push(`${propName}: ${values[0]}`);
    }
  }

  // Rebuild customCss from resolved rules
  const seenCss = new Set<string>();
  for (const [selector, props] of resolvedRules) {
    const rule = `${selector} { ${props.join('; ')} }`;
    if (!seenCss.has(rule)) {
      seenCss.add(rule);
      tokens.customCss.push(rule);
    }
  }
}

// ─── Alias Detection ───

function detectAliases(
  bodyToSelectors: Map<string, string[]>,
  tokens: DesignTokens,
): void {
  for (const [, selectors] of bodyToSelectors) {
    // Deduplicate selectors and count occurrences
    const selectorCounts: Map<string, number> = new Map();
    for (const sel of selectors) {
      selectorCounts.set(sel, (selectorCounts.get(sel) || 0) + 1);
    }

    const uniqueSelectors = [...selectorCounts.keys()];
    if (uniqueSelectors.length < 2) continue;

    // Pick canonical as the most frequent selector
    let maxCount = 0;
    let canonical = uniqueSelectors[0];
    for (const [sel, count] of selectorCounts) {
      if (count > maxCount || (count === maxCount && sel < canonical)) {
        maxCount = count;
        canonical = sel;
      }
    }

    // Map all others as aliases of the canonical
    for (const sel of uniqueSelectors) {
      if (sel !== canonical) {
        tokens.aliases[sel] = canonical;
      }
    }
  }
}

// ─── Font Import Merge ───

function mergeFontImports(urls: string[]): string[] {
  // Parse each URL and group weights by font family
  // URL format: https://fonts.googleapis.com/css2?family=Name:wght@100;200&family=Other:wght@400&display=swap
  const familyWeights: Map<string, Set<string>> = new Map();
  let display = 'swap'; // default

  for (const url of urls) {
    // Extract display parameter
    const displayMatch = url.match(/[&?]display=([^&]+)/);
    if (displayMatch) display = displayMatch[1];

    // Extract all family parameters
    const familyMatches = url.matchAll(/[&?]family=([^&]+)/g);
    for (const match of familyMatches) {
      const familyParam = decodeURIComponent(match[1]);
      // Parse "Name:wght@100;200;300..700" or "Name:wght@100..700" or just "Name"
      const nameWeightMatch = familyParam.match(/^([^:]+)(?::wght@(.+))?$/);
      if (!nameWeightMatch) continue;
      const familyName = nameWeightMatch[1];
      const weightsStr = nameWeightMatch[2];

      if (!familyWeights.has(familyName)) {
        familyWeights.set(familyName, new Set());
      }
      const weights = familyWeights.get(familyName)!;

      if (weightsStr) {
        // Parse individual weights and ranges like "100;200" or "100..700"
        const parts = weightsStr.split(';');
        for (const part of parts) {
          if (part.includes('..')) {
            // Range: expand to individual weights (100-step increments)
            const [startStr, endStr] = part.split('..');
            const start = parseInt(startStr, 10);
            const end = parseInt(endStr, 10);
            for (let w = start; w <= end; w += 100) {
              weights.add(String(w));
            }
          } else {
            weights.add(part);
          }
        }
      }
    }
  }

  if (familyWeights.size === 0) return [];

  // Build merged URLs - one URL with all families
  const familyParts: string[] = [];
  for (const [name, weights] of familyWeights) {
    if (weights.size > 0) {
      const sortedWeights = [...weights].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
      familyParts.push(`family=${encodeURIComponent(name)}:wght@${sortedWeights.join(';')}`);
    } else {
      familyParts.push(`family=${encodeURIComponent(name)}`);
    }
  }

  return [`https://fonts.googleapis.com/css2?${familyParts.join('&')}&display=${display}`];
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
