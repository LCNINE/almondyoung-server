'use server';

import { revalidatePath } from 'next/cache';

import {
  ensureCorrectShippingMethod,
  findUnavailableLineItems,
  initiatePaymentSession,
  retrieveCart,
  updateCart,
} from '@/checkout-ui/lib/api/medusa/cart';
import { buildPaymentItems } from '@/checkout-ui/lib/utils/build-payment-items';
import type { CartResponseDto } from '@/checkout-ui/lib/types/dto/medusa';
import type { ShippingMemo } from '@/checkout-ui/domains/checkout/components/sections/shipping/types';

import { CHECKOUT_CART_FIELDS } from './cart-fields';

export type PrepareResult =
  | { ok: true; intentId: string }
  | { ok: false; code: 'AMOUNT_CHANGED' | 'UNAVAILABLE_ITEMS' | 'ERROR'; message: string };

interface PrepareInput {
  cartId: string;
  region: string;
  requiresShipping: boolean;
  shippingMemo: ShippingMemo | null;
  memoChanged: boolean;
  personalCustomsCode: string | null;
  orderName: string;
  /** 화면에 표시된 최종 결제금액. 서버 카트와 어긋나면 결제를 중단한다. */
  displayedTotal: number;
}

/**
 * 결제 직전 준비. 카트를 최신화하고 결제 인텐트를 만든다.
 *
 * 인텐트를 화면 진입이 아니라 여기서 만드는 이유: Medusa 의 almond-payment updatePayment 는
 * 금액이 바뀌면 인텐트를 새로 만들면서 returnUrl·orderName·items·customerEmail 을 전부 버린다.
 * 그러면 성공 페이지의 소유권 검증이 실패해 주문이 안 보인다. 배송비·쿠폰이 바뀔 수 있는 화면에서
 * 인텐트를 미리 들고 있을 수 없다.
 */
export async function prepareCheckout(input: PrepareInput): Promise<PrepareResult> {
  try {
    const {
      cartId,
      region,
      requiresShipping,
      shippingMemo,
      memoChanged,
      personalCustomsCode,
      orderName,
      displayedTotal,
    } = input;

    // 배송이 필요한 카트에서만 배송메모를 저장한다. 값이 그대로면 건너뛴다.
    if (requiresShipping && memoChanged && shippingMemo) {
      await updateCart(
        {
          metadata: {
            shipping_memo_type: shippingMemo.type,
            shipping_memo_custom: shippingMemo.type === 'other' ? shippingMemo.custom : '',
            has_entrance: shippingMemo.type === 'door' ? shippingMemo.hasEntrance : false,
            entrance_password:
              shippingMemo.type === 'door' && shippingMemo.hasEntrance ? shippingMemo.entrancePassword : '',
          },
        },
        cartId,
      );
    }

    let cart = (await retrieveCart(cartId, CHECKOUT_CART_FIELDS, 'no-store')) as CartResponseDto['cart'];
    if (!cart) {
      return { ok: false, code: 'ERROR', message: '장바구니를 찾을 수 없어요. 다시 시도해 주세요.' };
    }

    // 해외직구 상품이 있으면 개인통관고유부호를 shipping_address.metadata 에 저장
    if (personalCustomsCode && cart.shipping_address) {
      const addr = cart.shipping_address;
      await updateCart(
        {
          shipping_address: {
            first_name: addr.first_name ?? undefined,
            last_name: addr.last_name ?? undefined,
            phone: addr.phone ?? undefined,
            company: addr.company ?? undefined,
            address_1: addr.address_1 ?? undefined,
            address_2: addr.address_2 ?? undefined,
            city: addr.city ?? undefined,
            province: addr.province ?? undefined,
            postal_code: addr.postal_code ?? undefined,
            country_code: addr.country_code ?? undefined,
            metadata: { ...(addr.metadata ?? {}), personalCustomsCode: personalCustomsCode.trim() },
          },
        },
        cartId,
      );
    }

    // 담은 뒤 재고가 줄었거나 판매중단된 라인은 여기서 막는다. 그대로 결제로 보내면 주문 확정의
    // 재고예약이 실패한다(지연승인 덕에 돈은 안 빠지지만 사용자는 이유를 모른다).
    const { productNames, insufficientNames } = await findUnavailableLineItems(cart, region);
    const blocked = Array.from(new Set(productNames.concat(insufficientNames)));
    if (blocked.length > 0) {
      return {
        ok: false,
        code: 'UNAVAILABLE_ITEMS',
        message: `품절되거나 판매가 중단된 상품이 있어요: ${blocked.join(', ')}`,
      };
    }

    // 어드민이 배송비 그룹 금액을 고쳐도 옛 금액으로 결제되지 않도록 다시 붙인다.
    const shippingResult = await ensureCorrectShippingMethod(cart, { refreshAmounts: true });
    cart = shippingResult.cart as CartResponseDto['cart'];

    // 다른 탭에서 장바구니를 고쳤거나 배송비/쿠폰이 바뀌어 화면 금액과 어긋나면 결제를 멈춘다.
    if (typeof cart.total === 'number' && cart.total !== displayedTotal) {
      revalidatePath('/checkout');
      return {
        ok: false,
        code: 'AMOUNT_CHANGED',
        message: '결제 금액이 변경되었어요. 금액을 다시 확인해 주세요.',
      };
    }

    const paymentItems = buildPaymentItems(
      cart.items ?? [],
      shippingResult.requiresShipping ? cart.shipping_methods : [],
    );

    // returnUrl 에 cartId 를 싣지 않는다 — 실으면 storefront 콜백이 능동 cart.complete 경로를 타
    // capture 웹훅과 카트 락 경합을 일으킨다(2026-06-26 라이브 회귀). 주문 확정은 wallet-web 이
    // finalizeOrder 로 직접 하고, 이 값은 wallet 쪽 기록·폴백용으로만 남는다.
    const returnUrl = `${process.env.STOREFRONT_ORIGIN}/${region}/checkout/success`;

    const result = await initiatePaymentSession(cart, {
      provider_id: 'pp_almond-payment_almond-payment',
      data: { returnUrl, orderName, items: paymentItems },
    });

    const intentId = (result?.payment_collection?.payment_sessions?.[0]?.data as Record<string, unknown>)
      ?.intentId as string | undefined;

    if (!intentId) {
      return { ok: false, code: 'ERROR', message: '결제 준비에 실패했어요. 다시 시도해 주세요.' };
    }

    return { ok: true, intentId };
  } catch (error) {
    return {
      ok: false,
      code: 'ERROR',
      message: error instanceof Error ? error.message : '결제 준비 중 문제가 생겼어요.',
    };
  }
}
