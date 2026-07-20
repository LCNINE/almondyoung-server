import { describe, it, expect } from 'vitest';
import { createScanBuffer } from './scanBuffer';

describe('createScanBuffer', () => {
  it('emits the code when a fast burst ends with Enter', () => {
    const b = createScanBuffer();
    expect(b.feed('8', 0)).toBeNull();
    expect(b.feed('8', 10)).toBeNull();
    expect(b.feed('0', 20)).toBeNull();
    expect(b.feed('1', 30)).toBeNull();
    expect(b.feed('Enter', 40)).toBe('8801');
  });

  it('resets on a slow gap (human typing) and does not emit', () => {
    const b = createScanBuffer({ maxInterKeyMs: 50 });
    b.feed('a', 0);
    b.feed('b', 500); // 500ms gap → typing → buffer reset to just 'b'
    expect(b.feed('Enter', 510)).toBeNull(); // 'b' alone < minLength
  });

  it('ignores a terminator with no accumulated chars', () => {
    const b = createScanBuffer();
    expect(b.feed('Enter', 0)).toBeNull();
  });

  it('respects minLength (rejects too-short bursts)', () => {
    const b = createScanBuffer({ minLength: 4 });
    b.feed('1', 0);
    b.feed('2', 5);
    expect(b.feed('Enter', 10)).toBeNull(); // only 2 chars
  });

  it('supports Tab as terminator', () => {
    const b = createScanBuffer({ terminator: 'Tab' });
    b.feed('X', 0);
    b.feed('Y', 5);
    b.feed('Z', 10);
    b.feed('Q', 15);
    expect(b.feed('Tab', 20)).toBe('XYZQ');
  });

  it('ignores non-single-character keys (modifiers) mid-burst', () => {
    const b = createScanBuffer();
    b.feed('9', 0);
    b.feed('9', 10);
    b.feed('Shift', 20); // multi-char key name → ignored, must not accumulate
    b.feed('1', 30);
    b.feed('2', 40);
    expect(b.feed('Enter', 50)).toBe('9912');
  });
});
