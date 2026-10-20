export type InstallBannerKind = 'ios' | 'android' | 'inapp-ios' | 'inapp-android';

export const INSTALL_BANNER_DISMISSED_KEY = 'attendance-install-banner-dismissed';

// 카카오톡·네이버·인스타그램 같은 인앱 브라우저와 iOS 의 Safari 아닌 브라우저는 홈 화면 추가가 안 된다
const IN_APP = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|CriOS|FxiOS|EdgiOS|Whale/i;

export function installBannerKind({
  userAgent,
  maxTouchPoints,
  standalone,
}: {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
}): InstallBannerKind | null {
  if (standalone) return null;

  const ios =
    /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1);

  const android = /Android/.test(userAgent);

  if (IN_APP.test(userAgent)) {
    if (ios) return 'inapp-ios';
    if (android) return 'inapp-android';
  }
  if (ios) return 'ios';
  // 설치 창(beforeinstallprompt)은 삼성 인터넷·조건 미충족이면 안 와서, 안 와도 띠는 띄우고 메뉴 안내로 받는다
  if (android) return 'android';

  return null;
}
