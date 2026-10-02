import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStationDevice } from './station';

const os = vi.hoisted(() => ({ name: 'windows' }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => os.name }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isStationDevice', () => {
  it('Windows 면 스테이션', () => {
    os.name = 'windows';
    expect(isStationDevice()).toBe(true);
  });
  it('리눅스 데스크톱도 스테이션', () => {
    os.name = 'linux';
    expect(isStationDevice()).toBe(true);
  });
  it('Android 면 아니다', () => {
    os.name = 'android';
    expect(isStationDevice()).toBe(false);
  });
  it('VITE_PROFILE=handheld 면 데스크톱에서도 핸드헬드', () => {
    os.name = 'linux';
    vi.stubEnv('VITE_PROFILE', 'handheld');
    expect(isStationDevice()).toBe(false);
  });
});
