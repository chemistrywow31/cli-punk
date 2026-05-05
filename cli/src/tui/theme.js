export const bauhaus = {
  bg: '#f8f5e9',
  warm: '#e9e3cf',
  panel: '#fffdf2',
  text: '#111111',
  muted: '#4a4a42',
  red: '#d62d20',
  yellow: '#f7c600',
  blue: '#0057b8',
  green: '#008f66',
  errorBg: '#f4d4c8',
  codeBg: '#111111',
  codeText: '#fffdf2',
};

export function statusColor(status) {
  switch (status) {
    case 'online':
      return bauhaus.green;
    case 'reconnecting':
      return bauhaus.yellow;
    case 'forbidden':
    case 'auth invalid':
      return bauhaus.red;
    default:
      return bauhaus.muted;
  }
}
