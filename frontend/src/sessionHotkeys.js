export const SESSION_HOTKEYS = '1234567890'.split('');

export function nextSessionHotkey(usedHotkeys) {
  for (const key of SESSION_HOTKEYS) {
    if (!usedHotkeys.has(key)) return key;
  }
  return '';
}

export function sessionHotkeyFromEvent(event) {
  if (!event?.altKey || event.ctrlKey || event.metaKey) return '';
  return SESSION_HOTKEYS.includes(event.key) ? event.key : '';
}

export function formatSessionHotkey(hotkey) {
  return hotkey ? `Alt+${hotkey}` : '-';
}
