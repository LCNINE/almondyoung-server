export type InstallBannerKind = 'ios' | 'inapp' | 'android';

export const INSTALL_BANNER_DISMISSED_KEY = 'attendance-install-banner-dismissed';

// 카카오톡·네이버·인스타그램 같은 인앱 브라우저와 iOS 의 Safari 아닌 브라우저는 홈 화면 추가가 안 된다
const IN_APP = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|CriOS|FxiOS|EdgiOS|Whale/i;

export function installBannerKind({
  userAgent,
  maxTouchPoints,
  standalone,
  hasInstallPrompt,
}: {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
  hasInstallPrompt: boolean;
}): InstallBannerKind | null {
  if (standalone) return null;

  const ios =
    /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1);

  if (IN_APP.test(userAgent)) return ios || /Android/.test(userAgent) ? 'inapp' : null;
  if (ios) return 'ios';
  // Chrome 은 이미 설치했으면 beforeinstallprompt 를 안 쏜다 — 이벤트가 곧 「미설치」 신호다
  if (hasInstallPrompt && /Android/.test(userAgent)) return 'android';

  return null;
}
