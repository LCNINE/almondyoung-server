import { describe, expect, it, vi } from 'vitest';
import { isStationDevice } from './station';

const os = vi.hoisted(() => ({ name: 'windows' }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => os.name }));

describe('isStationDevice', () => {
  it('Windows 면 스테이션', () => {
    os.name = 'windows';
    expect(isStationDevice()).toBe(true);
  });
  it('Android 면 아니다', () => {
    os.name = 'android';
    expect(isStationDevice()).toBe(false);
  });
});
