const OSC_PATTERN = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;
const CSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const ESC_PATTERN = /\x1b[ -/]*[@-~]/g;

export function normalizeTerminalText(raw) {
  return raw
    .replace(OSC_PATTERN, '')
    .replace(/\x1b\[\?1049[hl]/g, '')
    .replace(CSI_PATTERN, '')
    .replace(ESC_PATTERN, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[^\S\n\t ]+$/gm, '');
}

export function appendCapped(existing, chunk, maxBytes = 100_000) {
  const combined = `${existing || ''}${chunk || ''}`;
  const buf = Buffer.from(combined, 'utf8');
  if (buf.length <= maxBytes) return combined;
  return buf.subarray(buf.length - maxBytes).toString('utf8');
}

export function escapeTags(value) {
  return String(value ?? '').replace(/[{}]/g, '');
}
