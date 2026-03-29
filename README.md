# ui-canon

Headless UI canonicalizer and drift detector. Extracts **canonical, AI-consumable component representations** and consistency reports from generated (Stitch, etc.) or hand-written Tailwind-based HTML/JSX screens.

**[Magyar verzió lejjebb / Hungarian version below](#hu)**

---

## Why?

Google Stitch and similar AI UI generators don't maintain consistency across multiple screens: headers, sidebars, forms, and buttons diverge. When you pass these screens to an AI for development, the AI can't tell which variant is "correct."

**ui-canon** takes raw screens and produces a clean, canonicalized UI description — compact and unambiguous input for AI coding assistants.

## Install

```bash
npm install
npm run build
```

## Usage

### Basic

```bash
node dist/cli/index.js analyze ./input-dir --out ./out
```

### Verbose

```bash
node dist/cli/index.js analyze ./input-dir --out ./out --verbose
```

### With config file

```bash
node dist/cli/index.js analyze ./input-dir --out ./out --config ./canonicalizer.config.json
```

## Supported input formats

- `.html` — **primary support** — full HTML files (Stitch export, any HTML generator)
- `.jsx` / `.tsx` — **basic only** — handles simple static JSX markup (e.g. a single `return(...)` block). Dynamic logic (ternary, map, spread props) is replaced with `__DYNAMIC__` placeholders.

## Output files

The `--out` directory will contain:

### `canonical-ui.json` — Primary output (for AI)

```
aiGuidance          → Instructions for the AI on how to use this file
designTokens        → Colors, fonts, border-radius, custom CSS, icon system
canonicalComponents → Canonical components with HTML, variants, and slots
screenMap           → Which components each original screen uses
attachedFiles       → Extra files (e.g. DESIGN.md) if configured
```

Hand this file to the AI — it contains everything needed.

### `analysis-summary.json` — Statistics

File counts, node counts, cluster counts, drift issue counts, pipeline timing.

### `drift-report.json` — Inconsistencies

Detailed list of cross-screen deviations: typography, spacing, color, radius/shadow drift.

### `summary.md` — Human-readable summary

Markdown overview: design tokens, components, screen composition, top drift issues.

## Config options

See `canonicalizer.config.json` — all optional, sensible defaults provided:

| Option                          | Default                                 | Description                            |
| ------------------------------- | --------------------------------------- | -------------------------------------- |
| `inputGlobs`                    | `["**/*.html", "**/*.jsx", "**/*.tsx"]` | File patterns to scan                  |
| `exclude`                       | `["node_modules/**", ...]`              | Patterns to skip                       |
| `excludeFiles`                  | `[]`                                    | Extra exclusions (e.g. `["drafts/**"]`) |
| `attachFiles`                   | `[]`                                    | Extra files to embed in output (e.g. `["DESIGN.md"]`) |
| `candidate.minDepth`            | `2`                                     | Minimum tree depth for candidates      |
| `candidate.minNodeCount`        | `5`                                     | Minimum node count for candidates      |
| `similarity.nearMatchThreshold` | `0.75`                                  | Similarity threshold for clustering    |
| `similarity.structureWeight`    | `0.4`                                   | Structure weight in scoring            |
| `similarity.classWeight`        | `0.3`                                   | Tailwind class weight in scoring       |
| `maxFileSizeBytes`              | `1000000`                               | Max file size (1MB)                    |
| `verbose`                       | `false`                                 | Detailed logging                       |

## MCP Server (optional)

The canonicalizer can also run as an MCP server — AI agents (e.g. Claude) can send HTML content for analysis directly, without saving files to disk. Useful with Stitch MCP: the AI fetches screens from Stitch and analyzes them in one flow.

### Setup

The `.mcp.json` in the project root auto-registers the server in Claude Code. For other setups:

```json
{
  "mcpServers": {
    "ui-canonicalizer": {
      "command": "node",
      "args": ["/path/to/ui-canon/dist/mcp/index.js"]
    }
  }
}
```

### Connecting Stitch MCP (optional)

> **Important:** The Stitch MCP is a remote HTTP server and must be added at **user level** (`-s user`). Adding it to a project-level `.mcp.json` will fail with a schema validation error in Claude Code.

```bash
claude mcp add stitch --transport http https://stitch.googleapis.com/mcp --header "X-Goog-Api-Key: YOUR-API-KEY" -s user
```

Generate your API key at [Stitch Settings](https://stitch.withgoogle.com).

### Available MCP tools

**`analyze_files`** — Analyze HTML content directly (main MCP use case)

The AI fetches screens from Stitch MCP, sends them here. Results stay in AI memory, no files written.

```
analyze_files({
  files: [
    { name: "dashboard.html", content: "<html>..." },
    { name: "clients.html", content: "<html>..." }
  ]
})
```

**`analyze_directory`** — Analyze a local directory via MCP

```
analyze_directory({ directory: "/path/to/stitch-export" })
```

**`save_output`** — Save analysis results to disk

If you want to keep the results from `analyze_files`, ask the AI to save them:

```
save_output({
  canonicalUiJson: "...",
  outputDir: "/path/to/output"
})
```

Writes `canonical-ui.json` and `summary.md` to the specified directory.

## Development

```bash
npm run dev          # TypeScript watch mode
npm run test         # Run tests
npm run test:watch   # Watch mode tests
npm run lint         # Type check
```

## Known limitations

- JSX/TSX parsing is heuristic (no full Babel parser) — handles simple static markup only
- Component naming is rule-based, not semantic — can be imprecise
- Screens with very different structures won't cluster together
- Optimized for Tailwind CSS classes — less accurate with other CSS approaches
- Target performance: ~100 files / 2000 candidates under 30 seconds

---

<a id="hu"></a>

# ui-canon (Magyar)

Headless UI kanonizáló és drift detektor. Generált (Stitch, stb.) vagy kézzel írt Tailwind-alapú HTML/JSX screen-ekből **kanonikus, AI-fogyasztható komponens-reprezentációt** és konzisztencia-riportot állít elő.

## Miért?

A Google Stitch és hasonló AI UI generátorok nem tartják a konzisztenciát több screen között: eltérő header, sidebar, form stílusok jelennek meg. Ha ezeket tovább adod egy AI-nak fejlesztésre, az AI nem tudja melyik variáns a "helyes".

Az **ui-canon** a nyers screen-ekből egy tiszta, kanonizált UI leírást állít elő, amit az AI kompakt, egyértelmű inputként kap.

## Telepítés

```bash
npm install
npm run build
```

## Használat

```bash
# Alap futtatás
node dist/cli/index.js analyze ./input-mappa --out ./out

# Verbose mód
node dist/cli/index.js analyze ./input-mappa --out ./out --verbose

# Config fájllal
node dist/cli/index.js analyze ./input-mappa --out ./out --config ./canonicalizer.config.json
```

## Támogatott input formátumok

- `.html` — **elsődleges támogatás** — teljes HTML fájlok (Stitch export, bármilyen HTML generátor)
- `.jsx` / `.tsx` — **csak alap szint** — egyszerű, statikus JSX markup-ot kezel. Dinamikus logikát (ternary, map, spread props) nem értelmez, `__DYNAMIC__` placeholder-rel jelöli.

## Output fájlok

| Fájl | Kinek szól | Mit tartalmaz |
|---|---|---|
| `canonical-ui.json` | AI-nak | Design tokenek, kanonikus komponensek, screen map, AI útmutató |
| `analysis-summary.json` | Mindkettőnek | Statisztikák, pipeline timing |
| `drift-report.json` | Mindkettőnek | Inkonzisztenciák listája (typography, spacing, color drift) |
| `summary.md` | Embernek | Markdown összefoglaló: tokenek, komponensek, drift-ek |

## Config opciók

Lásd `canonicalizer.config.json` — minden opcionális, van default:

| Opció | Default | Leírás |
|---|---|---|
| `inputGlobs` | `["**/*.html", "**/*.jsx", "**/*.tsx"]` | Mely fájlokat keresse |
| `exclude` | `["node_modules/**", ...]` | Mit hagyjon ki |
| `excludeFiles` | `[]` | Extra kizárások (pl. `["drafts/**"]`) |
| `attachFiles` | `[]` | Extra fájlok csatolása (pl. `["DESIGN.md"]`) |
| `candidate.minDepth` | `2` | Minimális fa-mélység |
| `candidate.minNodeCount` | `5` | Minimális node szám |
| `similarity.nearMatchThreshold` | `0.75` | Hasonlósági küszöb |
| `maxFileSizeBytes` | `1000000` | Max fájl méret (1MB) |
| `verbose` | `false` | Részletes log |

## MCP Server mód (opcionális)

MCP szerverként is futtatható — az AI közvetlenül küldhet HTML-t elemzésre. Stitch MCP-vel kombinálva: az AI lekéri a screen-eket a Stitch-ből, elemzi, és azonnal használja az eredményt.

### Stitch MCP bekötése

> **Fontos:** A Stitch MCP remote HTTP szerver, ezért **user szinten** (`-s user`) kell hozzáadni. Projekt szintű `.mcp.json`-ből nem működik – Claude Code sémavalidációs hibát dob.

```bash
claude mcp add stitch --transport http https://stitch.googleapis.com/mcp --header "X-Goog-Api-Key: YOUR-API-KEY" -s user
```

### MCP tool-ok

| Tool | Mit csinál |
|---|---|
| `analyze_files` | HTML tartalmat elemez, eredményt visszaadja az AI-nak (nem ír fájlt) |
| `analyze_directory` | Lokális mappát elemez MCP-n keresztül |
| `save_output` | Elemzés eredményét lemezre menti (ha a user kéri) |

## Fejlesztés

```bash
npm run dev          # TypeScript watch mód
npm run test         # Tesztek futtatása
npm run test:watch   # Tesztek watch módban
npm run lint         # Type check
```

## Ismert korlátok

- JSX/TSX parse heurisztikus — egyszerű statikus markup-ot kezel
- Komponens naming szabályalapú, nem szemantikus
- Nagyon eltérő struktúrájú screen-ek nem kerülnek közös klaszterbe
- Tailwind CSS-re optimalizált
- Cél: ~100 fájl / 2000 candidate 30 mp alatt
