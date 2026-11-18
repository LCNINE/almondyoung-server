import { randomUUID } from 'node:crypto';
import { expectOk, probe } from '../../tenancy/isolation-check/http';
import type { CustomerSession } from './buyer';
import type { OrderPathConfig } from './config';
import type { Recipient } from './plan';
import type { SeededVariant } from './products';

/**
 * 스토어프론트 체크아웃(`web/almondyoung-storefront/src/lib/api/medusa/cart.ts`·`checkout-template.tsx`)을
 * 브라우저 없이 그대로 — 장바구니 → 배송 → almond-payment 세션 → wallet 포인트 결제 → 장바구니 완료.
 * 로컬 결제수단은 포인트 하나다(문서 §8 — 카드·무통장은 외부 PG 를 부른다).
 */

const PROVIDER_ID = 'pp_almond-payment_almond-payment';

interface StoreCart {
  id: string;
  items: {
    id: string;
    title: string;
    product_title?: string | null;
    variant_id?: string | null;
    unit_price: number;
    compare_at_unit_price?: number | null;
    quantity: number;
  }[];
  shipping_methods?: { id: string; name?: string | null; amount: number }[];
  payment_collection?: { id: string } | null;
}

export async function placeMedusaOrder(
  cfg: OrderPathConfig,
  session: CustomerSession,
  variant: SeededVariant,
  recipient: Recipient,
): Promise<{ medusaOrderId: string; amount: number }> {
  const store = (path: string) => `${cfg.medusaUrl}${path}`;
  const opts = (json?: unknown) => ({
    bearer: session.medusaJwt,
    headers: { 'x-publishable-api-key': cfg.publishableKey },
    ...(json === undefined ? {} : { json }),
  });

  const { regions } = (await expectOk('GET', store('/store/regions?fields=id,*countries'), opts())) as {
    regions: { id: string; countries?: { iso_2: string }[] }[];
  };
  const region = regions.find((r) => r.countries?.some((c) => c.iso_2 === 'kr'));
  if (!region) throw new Error('Medusa 에 kr 이 든 region 이 없다 → npm run bootstrap:e2e:local (Medusa 시드)');

  const { cart: created } = (await expectOk(
    'POST',
    store('/store/carts'),
    opts({ region_id: region.id, email: session.email, metadata: { cart_kind: 'shopping' } }),
  )) as { cart: StoreCart };
  const cartId = created.id;

  await expectOk(
    'POST',
    store(`/store/carts/${cartId}/add-line-item`),
    opts({ variant_id: variant.medusaVariantId, quantity: 1 }),
  );
  await expectOk(
    'POST',
    store(`/store/carts/${cartId}`),
    opts({
      shipping_address: {
        first_name: recipient.firstName,
        last_name: recipient.lastName,
        phone: recipient.phone,
        province: recipient.province,
        city: recipient.city,
        address_1: recipient.address1,
        address_2: recipient.address2,
        postal_code: recipient.postalCode,
        country_code: 'kr',
      },
      // 배송 요청사항은 필수다 — 「비밀번호없이 출입 가능해요」(문서 §8-F ②).
      metadata: {
        cart_kind: 'shopping',
        shipping_address_name: 'E2E',
        shipping_memo_type: 'door',
        shipping_memo_custom: '',
        has_entrance: false,
        entrance_password: '',
      },
    }),
  );

  const { shipping_options } = (await expectOk(
    'GET',
    store(`/store/shipping-options?cart_id=${cartId}&fields=id,name,amount,type,shipping_profile_id`),
    opts(),
  )) as { shipping_options: { id: string; shipping_profile_id: string; type?: { code?: string } }[] };
  const perProfile = new Map<string, string>();
  for (const o of shipping_options) {
    if (o.type?.code === 'standard' && !perProfile.has(o.shipping_profile_id))
      perProfile.set(o.shipping_profile_id, o.id);
  }
  if (perProfile.size === 0) throw new Error(`장바구니 ${cartId} 에 standard 배송 옵션이 없다`);
  await expectOk(
    'POST',
    store(`/store/carts/${cartId}/shipping-methods/bulk`),
    opts({ option_ids: [...perProfile.values()] }),
  );

  const { cart } = (await expectOk('GET', store(`/store/carts/${cartId}`), opts())) as { cart: StoreCart };
  const collectionId =
    cart.payment_collection?.id ??
    (
      (await expectOk('POST', store('/store/payment-collections'), opts({ cart_id: cartId }))) as {
        payment_collection: { id: string };
      }
    ).payment_collection.id;
  const { payment_collection } = (await expectOk(
    'POST',
    store(`/store/payment-collections/${collectionId}/payment-sessions`),
    opts({
      provider_id: PROVIDER_ID,
      data: {
        returnUrl: 'http://localhost:8000/kr/checkout/callback',
        orderName: '[E2E] 주문 경로',
        items: paymentItems(cart),
        customerEmail: session.email,
      },
    }),
  )) as { payment_collection: { payment_sessions: { data: { intentId: string; amount: number } }[] } };
  const { intentId, amount } = payment_collection.payment_sessions[0].data;

  // 포인트 전액 — wallet-web 결제창이 하는 호출(`wallet-web/lib/wallet-api.ts`). 결제수단 id 없이 포인트만 쓴다.
  const paid = await probe('POST', `${cfg.walletUrl}/v1/payment-intents/${intentId}/confirm`, {
    bearer: session.userServiceToken,
    headers: { 'idempotency-key': randomUUID() },
    json: { pointsToApply: amount },
  });
  if (paid.status < 200 || paid.status >= 300) {
    const body = JSON.stringify(paid.body);
    const hint = body.includes('INSUFFICIENT_POINTS')
      ? ' — 적립금이 바닥났다. LOCAL_POINT_REASON 을 바꿔 db:seed:points:local 을 다시(LOCAL_POINT_LOGIN_IDS=e2eorderbuyer)'
      : '';
    throw new Error(`포인트 결제 거절 ${paid.status} ${body.slice(0, 200)}${hint}`);
  }

  const done = await probe('POST', store(`/store/carts/${cartId}/complete`), opts());
  const body = done.body as { type?: string; order?: { id: string }; error?: { message?: string } } | null;
  if (body?.type === 'order' && body.order) return { medusaOrderId: body.order.id, amount };

  // 결제 웹훅이 먼저 장바구니를 완료했으면(스토어프론트도 성공으로 본다 — checkout/callback/actions.ts) 그 주문을 찾는다.
  const message = JSON.stringify(done.body);
  if (/already completed|completed cart/i.test(message)) {
    const { orders } = (await expectOk(
      'GET',
      store('/store/orders?fields=id,created_at&order=-created_at&limit=1'),
      opts(),
    )) as { orders: { id: string }[] };
    if (orders[0]) return { medusaOrderId: orders[0].id, amount };
  }
  throw new Error(`장바구니 완료 실패 ${done.status} ${message.slice(0, 300)}`);
}

/** 스토어프론트 `buildPaymentItems` 와 같은 모양 — 상품 줄(+멤버십 할인) + 배송비 줄. 이 시드는 쿠폰을 쓰지 않는다. */
function paymentItems(cart: StoreCart) {
  return [
    ...cart.items.map((item) => {
      // 정가 > 판매가면 그 차이를 멤버십 할인 줄로 싣는다 — 스토어프론트와 같다(합계가 intent 금액과 맞아야 한다).
      const compareAt = item.compare_at_unit_price ?? item.unit_price;
      const membership = compareAt > item.unit_price ? compareAt - item.unit_price : 0;
      return {
        lineId: item.id,
        name: item.product_title ?? item.title,
        itemType: 'PRODUCT',
        itemRefId: item.variant_id ?? undefined,
        unitPrice: membership > 0 ? compareAt : item.unit_price,
        quantity: item.quantity,
        ...(membership > 0
          ? {
              discounts: [
                { kind: 'ITEM_PER_UNIT', amount: membership, discountRefId: 'membership', name: '멤버십 할인' },
              ],
            }
          : {}),
      };
    }),
    ...(cart.shipping_methods ?? []).map((s) => ({
      lineId: s.id,
      name: s.name ?? '배송비',
      itemType: 'SHIPPING_FEE',
      unitPrice: s.amount,
      quantity: 1,
    })),
  ];
}
