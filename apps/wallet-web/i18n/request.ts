import { getRequestConfig } from 'next-intl/server';

import { getCheckoutRegion } from '@/lib/auth/session-cookies';

export const SUPPORTED_LOCALES = ['ko', 'en', 'ja'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'ko';

// storefront 의 countryCode → locale 매핑과 동일해야 한다 (src/lib/utils/locale-path.ts).
const COUNTRY_TO_LOCALE: Record<string, SupportedLocale> = {
  kr: 'ko',
  jp: 'ja',
  us: 'en',
  en: 'en',
};

export function countryCodeToLocale(countryCode?: string | null): SupportedLocale {
  if (!countryCode) return DEFAULT_LOCALE;
  return COUNTRY_TO_LOCALE[countryCode.toLowerCase()] ?? DEFAULT_LOCALE;
}

/**
 * wallet-web 은 URL 에 locale 세그먼트가 없다(결제 경로는 /pay, /checkout 뿐).
 * 체크아웃 핸드오프가 넘겨준 region 쿠키로 언어를 정한다 — 이게 없으면 한국어.
 */
export default getRequestConfig(async () => {
  const locale = countryCodeToLocale(await getCheckoutRegion());

  const [checkout, cart] = await Promise.all([
    import(`../messages/${locale}/checkout.json`),
    import(`../messages/${locale}/cart.json`),
  ]);

  return {
    locale,
    messages: { checkout: checkout.default, cart: cart.default },
  };
});
