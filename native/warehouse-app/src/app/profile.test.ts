import { describe, it, expect } from 'vitest';
import { parseProfileOverride, resolveProfile } from './profile';

describe('resolveProfile', () => {
  it.each(['windows', 'linux', 'macos'])('%s(데스크톱) → station', (platform) => {
    expect(resolveProfile(platform)).toBe('station');
  });
  it.each(['android', 'ios'])('%s(모바일) → handheld', (platform) => {
    expect(resolveProfile(platform)).toBe('handheld');
  });
  it('override wins over platform', () => {
    expect(resolveProfile('windows', 'handheld')).toBe('handheld');
    expect(resolveProfile('android', 'station')).toBe('station');
  });
});

describe('parseProfileOverride', () => {
  it('비어 있으면 덮어쓰지 않는다', () => {
    expect(parseProfileOverride(undefined)).toBeUndefined();
    expect(parseProfileOverride('')).toBeUndefined();
  });
  it('station·handheld 는 그대로', () => {
    expect(parseProfileOverride('station')).toBe('station');
    expect(parseProfileOverride('handheld')).toBe('handheld');
  });
  it('그 밖의 값은 조용히 무시하지 않고 던진다', () => {
    expect(() => parseProfileOverride('mobile')).toThrow(/VITE_PROFILE/);
  });
});
