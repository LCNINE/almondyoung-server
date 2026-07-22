import { describe, it, expect } from 'vitest';
import { resolveProfile } from './profile';

describe('resolveProfile', () => {
  it('windows → station', () => {
    expect(resolveProfile('windows')).toBe('station');
  });
  it('android → handheld', () => {
    expect(resolveProfile('android')).toBe('handheld');
  });
  it('unknown platform → handheld (safe default)', () => {
    expect(resolveProfile('linux')).toBe('handheld');
  });
  it('override wins over platform', () => {
    expect(resolveProfile('windows', 'handheld')).toBe('handheld');
  });
});
