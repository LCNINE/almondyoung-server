import { installBannerKind } from './install-banner';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const IPHONE_KAKAO = `${IPHONE_SAFARI} KAKAOTALK 10.9.0`;
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const base = { maxTouchPoints: 5, standalone: false, hasInstallPrompt: false };

it('hides the banner inside the installed app', () => {
  expect(
    installBannerKind({ ...base, userAgent: IPHONE_SAFARI, standalone: true })
  ).toBeNull();
});

it('guides iPhone Safari, including iPad in desktop mode', () => {
  expect(installBannerKind({ ...base, userAgent: IPHONE_SAFARI })).toBe('ios');
  expect(installBannerKind({ ...base, userAgent: IPAD_DESKTOP_MODE })).toBe('ios');
});

it('asks in-app browsers to open Safari first', () => {
  expect(installBannerKind({ ...base, userAgent: IPHONE_KAKAO })).toBe('inapp');
});

it('offers Android install only when Chrome says the app is not installed', () => {
  expect(installBannerKind({ ...base, userAgent: ANDROID_CHROME })).toBeNull();
  expect(
    installBannerKind({ ...base, userAgent: ANDROID_CHROME, hasInstallPrompt: true })
  ).toBe('android');
});

it('stays out of the way on desktop', () => {
  expect(
    installBannerKind({
      ...base,
      userAgent: DESKTOP_CHROME,
      maxTouchPoints: 0,
      hasInstallPrompt: true,
    })
  ).toBeNull();
});
