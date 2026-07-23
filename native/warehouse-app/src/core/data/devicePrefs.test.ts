import { describe, it, expect } from 'vitest';
import { createMemoryPrefs } from './devicePrefs';

describe('createMemoryPrefs', () => {
  it('저장한 값을 돌려준다', () => {
    const prefs = createMemoryPrefs();
    prefs.set('k', 'v');
    expect(prefs.get('k')).toBe('v');
  });

  it('없는 키는 null 이다', () => {
    expect(createMemoryPrefs().get('nope')).toBeNull();
  });

  it('remove 후에는 null 이다', () => {
    const prefs = createMemoryPrefs();
    prefs.set('k', 'v');
    prefs.remove('k');
    expect(prefs.get('k')).toBeNull();
  });

  it('초기값을 주입할 수 있다', () => {
    expect(createMemoryPrefs({ k: 'seed' }).get('k')).toBe('seed');
  });
});
