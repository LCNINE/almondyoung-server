export interface ScanBufferOptions {
  /** key name that ends a scan (default 'Enter') */
  terminator?: string;
  /** max ms between keys to still count as one scan burst (default 50) */
  maxInterKeyMs?: number;
  /** minimum code length to emit (default 3) */
  minLength?: number;
}

/**
 * Distinguishes a barcode reader's keystroke burst from human typing:
 * scanners emit chars milliseconds apart and finish with Enter/Tab. Any gap
 * longer than `maxInterKeyMs` is treated as typing and resets the buffer.
 */
export function createScanBuffer(opts: ScanBufferOptions = {}) {
  const terminator = opts.terminator ?? 'Enter';
  const maxInterKeyMs = opts.maxInterKeyMs ?? 50;
  const minLength = opts.minLength ?? 3;

  let chars: string[] = [];
  let lastAt = -Infinity;

  function reset() {
    chars = [];
    lastAt = -Infinity;
  }

  function feed(key: string, at: number): string | null {
    if (key === terminator) {
      const code = chars.join('');
      reset();
      return code.length >= minLength ? code : null;
    }
    // Only single printable characters accumulate; ignore modifiers/arrows.
    if (key.length !== 1) return null;

    if (at - lastAt > maxInterKeyMs) chars = []; // gap → new burst
    chars.push(key);
    lastAt = at;
    return null;
  }

  return { feed, reset };
}
