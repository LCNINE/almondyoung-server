import { platform } from '@tauri-apps/plugin-os';
import { resolveProfile } from './profile';

/**
 * 라벨 인쇄처럼 Windows 스테이션에만 있는 기능의 판정 한 곳(#913). 핸드헬드(Android)엔 스풀러가 없다.
 * 화면은 이 값을 props 로 받는다 — 컴포넌트마다 platform() 을 부르면 테스트 모킹이 번진다.
 */
export function isStationDevice(): boolean {
  return resolveProfile(platform()) === 'station';
}
