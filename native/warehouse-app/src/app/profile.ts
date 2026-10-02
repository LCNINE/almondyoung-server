export type Profile = 'station' | 'handheld';

const MOBILE_PLATFORMS = new Set(['android', 'ios']);

/**
 * Default entry profile per platform. 데스크톱(Windows·Linux·macOS)은 스테이션, 모바일은 핸드헬드다 —
 * 카트에 얹은 노트북도 스테이션이다(스테이션 UI 스펙 U3). `override` 가 있으면 언제나 그것이 이긴다.
 */
export function resolveProfile(platform: string, override?: Profile): Profile {
  if (override) return override;
  return MOBILE_PLATFORMS.has(platform) ? 'handheld' : 'station';
}

/**
 * 빌드 환경변수 `VITE_PROFILE` 의 해석. 데스크톱에서 핸드헬드 화면을 개발할 때 쓴다(`npm run tauri:dev:handheld`).
 * 오타를 조용히 무시하면 「왜 스테이션이 뜨지?」를 쫓게 되므로 모르는 값은 던진다.
 */
export function parseProfileOverride(raw: string | undefined): Profile | undefined {
  if (!raw) return undefined;
  if (raw === 'station' || raw === 'handheld') return raw;
  throw new Error(`VITE_PROFILE 은 station 또는 handheld 여야 한다: ${raw}`);
}
