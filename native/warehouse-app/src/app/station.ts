import { platform } from '@tauri-apps/plugin-os';
import { parseProfileOverride, resolveProfile } from './profile';

/**
 * 스테이션 프로필 판정의 한 곳 — 셸·화면 선택과 라벨 인쇄처럼 스테이션에만 있는 기능이 모두 이것을 본다(#913).
 * 화면은 이 값을 props 로 받는다 — 컴포넌트마다 platform() 을 부르면 테스트 모킹이 번진다.
 */
export function isStationDevice(): boolean {
  return resolveProfile(platform(), parseProfileOverride(import.meta.env.VITE_PROFILE)) === 'station';
}
