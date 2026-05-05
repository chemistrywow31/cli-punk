const EXTERNAL_SRC_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const SAFE_EXTERNAL_HREF_RE = /^(?:https?:|mailto:|\/\/)/i;

export function resolveMarkdownAssetPath(markdownPath, assetSrc) {
  const src = String(assetSrc || '').trim();
  if (!src || src.startsWith('#') || EXTERNAL_SRC_RE.test(src)) return '';

  const pathPart = stripQueryAndHash(src);
  if (!pathPart) return '';

  const decoded = decodePath(pathPart);
  if (decoded.startsWith('/')) return normalizeWorkspacePath(decoded.slice(1));

  const baseDir = dirname(normalizeWorkspacePath(markdownPath));
  return normalizeWorkspacePath(baseDir ? `${baseDir}/${decoded}` : decoded);
}

export function resolveMarkdownLinkPath(markdownPath, href) {
  return resolveMarkdownAssetPath(markdownPath, href);
}

export function isExternalMarkdownHref(href) {
  return EXTERNAL_SRC_RE.test(String(href || '').trim());
}

export function isSafeExternalMarkdownHref(href) {
  return SAFE_EXTERNAL_HREF_RE.test(String(href || '').trim());
}

export function imageMimeForPath(filePath) {
  const ext = String(filePath || '').split('.').pop().toLowerCase();
  switch (ext) {
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'png':
      return 'image/png';
    case 'svg':
      return 'image/svg+xml';
    case 'ico':
      return 'image/x-icon';
    case 'bmp':
      return 'image/bmp';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

function stripQueryAndHash(src) {
  const hashIndex = src.indexOf('#');
  const withoutHash = hashIndex === -1 ? src : src.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf('?');
  return queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
}

function decodePath(rawPath) {
  try {
    return decodeURI(rawPath);
  } catch {
    return rawPath;
  }
}

function dirname(filePath) {
  const normalized = normalizeWorkspacePath(filePath);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

function normalizeWorkspacePath(rawPath) {
  const parts = String(rawPath || '').replace(/\\/g, '/').split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return '';
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}
