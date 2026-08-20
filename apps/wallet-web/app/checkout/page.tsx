import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

import { isAccessTokenUsable, selfOrigin } from '@/lib/auth/access-token';
import {
  SESSION_COOKIE_NAMES,
  backendAuthCookieFromToken,
  getCheckoutCartId,
  getCheckoutRegion,
  getMedusaJwt,
} from '@/lib/auth/session-cookies';
import {
  getAvailablePaymentMethods,
  getMyBusinessLicense,
  getPaymentMethods,
  getPointsBalance,
} from '@/lib/wallet-api';
import { ensureCorrectShippingMethod, findUnavailableLineItems, retrieveCart } from '@/checkout-ui/lib/api/medusa/cart';
import { retrieveCustomer } from '@/checkout-ui/lib/api/medusa/customer';
import { getMyPromotions } from '@/checkout-ui/lib/api/medusa/promotion';
import { isUnavailableVariantError } from '@/checkout-ui/lib/utils/cart-availability';
import { getMembershipGroupIdFromEnv } from '@/checkout-ui/lib/utils/membership-group';
import UnavailableItemsNotice from '@/checkout-ui/domains/checkout/components/unavailable-items-notice';
import type { CartResponseDto } from '@/checkout-ui/lib/types/dto/medusa';
import type { ShippingInfo } from '@/checkout-ui/lib/types/ui/cart';

import { CHECKOUT_CART_FIELDS } from './cart-fields';
import { CheckoutForm } from './checkout-form';

// 쿠키 기반 가드 + 카트별 동적 데이터라 캐시 금지 (/pay 와 같은 이유).
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ toss_fail?: string; intent?: string }>;
}

export default async function CheckoutPage({ searchParams }: Props) {
  const { toss_fail, intent: failedIntent } = await searchParams;
  const cookieStore = await cookies();

  // /pay 와 동일한 가드. access token 을 못 쓰면 ensure 가 refresh 로 먼저 살려 본다.
  const accessToken = cookieStore.get(SESSION_COOKIE_NAMES.ACCESS_TOKEN)?.value;
  if (!(await isAccessTokenUsable(accessToken))) {
    const ensurePath = `/auth/ensure?redirect_to=${encodeURIComponent('/checkout')}`;
    const origin = selfOrigin();
    redirect(origin ? `${origin}${ensurePath}` : ensurePath);
  }

  const [cartId, region, medusaJwt] = await Promise.all([getCheckoutCartId(), getCheckoutRegion(), getMedusaJwt()]);

  // 핸드오프 값이 만료됐거나 없다 → storefront 브릿지로 되돌려 다시 받아온다.
  // medusaJwt 없이 진행하면 안 된다: Medusa 는 비인증 요청에 에러 없이 비회원가를 주고
  // 발급 쿠폰도 말없이 거부한다(멤버십 할인이 조용히 사라진다).
  if (!cartId || !medusaJwt) {
    redirect(`${process.env.STOREFRONT_ORIGIN}/${region ?? 'kr'}/checkout`);
  }

  const countryCode = region ?? 'kr';
  const cookieHeader = backendAuthCookieFromToken(accessToken);

  let cart = (await retrieveCart(cartId, CHECKOUT_CART_FIELDS, 'no-store').catch(
    () => null,
  )) as CartResponseDto['cart'];

  if (!cart || !cart.items?.length) {
    redirect(`${process.env.STOREFRONT_ORIGIN}/${countryCode}/cart`);
  }

  // 카트에 의존하지 않는 조회(결제수단·포인트·쿠폰·사업자정보·번역)는 배송비 재계산과 함께
  // 한 번에 띄운다. 순차로 두면 각 왕복이 그대로 렌더 시간에 더해진다.
  const [availabilityResult, shippingSettled, ...rest] = await Promise.all([
    findUnavailableLineItems(cart, countryCode),
    ensureCorrectShippingMethod(cart, { refreshAmounts: true }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    getMyPromotions({ limit: 100 }).catch(() => ({ promotions: [], count: 0, offset: 0, limit: 100 })),
    retrieveCustomer().catch(() => null),
    getPaymentMethods(cookieHeader).catch(() => []),
    getAvailablePaymentMethods(countryCode, cookieHeader).catch(() => []),
    getPointsBalance(cookieHeader).catch(() => ({ confirmed: 0, reserved: 0, available: 0 })),
    getMyBusinessLicense(accessToken).catch(() => null),
    getMessages(),
  ] as const);

  const [promotionsResponse, customer, methods, availableMethods, pointsBalance, businessInfo, messages] = rest;

  const { productNames, insufficientNames } = availabilityResult;
  const blockedNames = Array.from(new Set(productNames.concat(insufficientNames)));
  if (blockedNames.length > 0) {
    return <UnavailableItemsNotice unavailableNames={blockedNames} />;
  }

  if (!shippingSettled.ok) {
    if (isUnavailableVariantError(shippingSettled.error)) {
      return <UnavailableItemsNotice unavailableNames={[]} />;
    }
    throw shippingSettled.error;
  }

  const { cart: updatedCart, shippingMethods, requiresShipping } = shippingSettled.value;
  cart = updatedCart as CartResponseDto['cart'];

  if (requiresShipping && !shippingMethods?.length) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col justify-center px-4 py-16">
        <div className="p-5 border rounded-md border-destructive/30 bg-destructive/5">
          <h1 className="text-base font-bold">배송 옵션을 찾을 수 없습니다.</h1>
          <p className="mt-2 text-sm leading-6">
            배송이 필요한 상품에 적용 가능한 배송 수단이 없습니다. 고객센터로 문의해주세요.
          </p>
        </div>
      </main>
    );
  }

  // 배송비는 카트의 shipping_total 을 쓴다 — 배송옵션 조회는 계산형 옵션의 amount 를 주지 않고,
  // 배송비 그룹이 2개 이상이면 첫 옵션 금액만으로는 합계가 되지 않는다.
  const shippingNames = (cart.shipping_methods ?? []).map((m) => m.name).filter(Boolean);
  const shipping: ShippingInfo = {
    amount: cart.shipping_total ?? 0,
    name: shippingNames.length ? shippingNames.join(' · ') : (shippingMethods?.[0]?.name ?? '배송비'),
    description: shippingMethods?.[0]?.type?.description ?? '',
  };

  return (
    <NextIntlClientProvider messages={messages}>
      <CheckoutForm
        cart={cart}
        cartId={cartId}
        countryCode={countryCode}
        shipping={shipping}
        promotions={promotionsResponse.promotions}
        isMembership={!!customer?.groups?.some((g) => g.id === getMembershipGroupIdFromEnv())}
        methods={methods}
        availableMethods={availableMethods}
        pointsBalance={pointsBalance}
        businessInfo={businessInfo}
        storefrontOrigin={process.env.STOREFRONT_ORIGIN ?? ''}
        abandonIntentId={toss_fail === '1' ? (failedIntent ?? null) : null}
      />
    </NextIntlClientProvider>
  );
}
