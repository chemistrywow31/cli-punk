export function flattenTree(nodes, { filter = '', expanded = new Set(), depth = 0 } = {}) {
  const result = [];
  const needle = filter.trim().toLowerCase();

  for (const node of nodes || []) {
    const matches = !needle || node.path.toLowerCase().includes(needle) || node.name.toLowerCase().includes(needle);
    const childRows = node.isDir
      ? flattenTree(node.children || [], { filter, expanded, depth: depth + 1 })
      : [];

    if (matches || childRows.length > 0) {
      result.push({
        name: node.name,
        path: node.path,
        isDir: !!node.isDir,
        size: node.size || 0,
        depth,
        expanded: node.isDir && expanded.has(node.path),
      });
      if (node.isDir && (expanded.has(node.path) || needle)) {
        result.push(...childRows);
      }
    }
  }

  return result;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

export function quoteShellPath(filePath) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(filePath)) return filePath;
  return `'${filePath.replace(/'/g, `'\\''`)}'`;
}
