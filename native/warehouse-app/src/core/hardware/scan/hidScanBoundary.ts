const preservedEnters = new WeakSet<KeyboardEvent>();

/**
 * Opt a scan-receiving dialog into HID Enter without allowing keyboard clicks.
 * Only this handler's own cancellation is exempt: an input or nested dialog
 * that already consumed Enter keeps its veto. Other dialogs need no changes.
 */
export function preventScanEnterActivation(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.code !== 'NumpadEnter') return;
  if (!event.defaultPrevented) preservedEnters.add(event);
  event.preventDefault();
}

export function isPreservedScanEnter(event: KeyboardEvent): boolean {
  return preservedEnters.has(event);
}
