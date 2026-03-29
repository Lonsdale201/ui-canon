import fg from 'fast-glob';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AnalyzerConfig, SourceFile } from '../types/index.js';

const SUPPORTED_EXTENSIONS = new Set(['.html', '.jsx', '.tsx']);

export async function collectSourceFiles(
  inputDir: string,
  config: AnalyzerConfig,
): Promise<SourceFile[]> {
  const patterns = config.inputGlobs.map(g =>
    path.posix.join(inputDir.replace(/\\/g, '/'), g),
  );

  const allExcludes = [...config.exclude, ...config.excludeFiles];

  const files = await fg(patterns, {
    ignore: allExcludes,
    absolute: true,
    onlyFiles: true,
  });

  const sourceFiles: SourceFile[] = [];

  for (const absPath of files) {
    const ext = path.extname(absPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

    try {
      const info = await stat(absPath);
      if (info.size > config.maxFileSizeBytes) continue;
      if (info.size === 0) continue;
    } catch {
      continue;
    }

    const relativePath = path.relative(inputDir, absPath).replace(/\\/g, '/');
    const fileName = path.basename(absPath);
    const screenId = path.basename(absPath, ext);

    sourceFiles.push({
      fileName,
      relativePath,
      absolutePath: absPath.replace(/\\/g, '/'),
      extension: ext,
      screenId,
    });
  }

  return sourceFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export async function readSourceFile(file: SourceFile): Promise<string> {
  return readFile(file.absolutePath, 'utf-8');
}

export async function collectAttachedFiles(
  inputDir: string,
  patterns: string[],
): Promise<Record<string, string>> {
  if (patterns.length === 0) return {};

  const globs = patterns.map(g =>
    path.posix.join(inputDir.replace(/\\/g, '/'), g),
  );

  const files = await fg(globs, { absolute: true, onlyFiles: true });
  const result: Record<string, string> = {};

  for (const absPath of files) {
    const relativePath = path.relative(inputDir, absPath).replace(/\\/g, '/');
    try {
      result[relativePath] = await readFile(absPath, 'utf-8');
    } catch {
      // skip unreadable
    }
  }

  return result;
}
