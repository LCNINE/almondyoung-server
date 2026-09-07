import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { logger } from '@medusajs/framework';
import type { RemoteQueryFunction } from '@medusajs/framework/types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OrderLineInput = {
  id: string;
  product_id: string;
  unit_price?: number | string | null;
  detail?: { quantity?: number | string | null } | null;
  adjustments?: Array<{ amount?: number | string | null }> | null;
};

type CreateReviewEligibilityInput = {
  customerId: string;
  orderId: string;
  items: OrderLineInput[];
};

const toNumber = (value: unknown): number | undefined => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/**
 * 라인 결제금액(원). 단가 × 수량 − 라인 할인.
 *
 * Medusa 의 계산 필드(`items.total`)는 필드를 지정해 조회하면 응답에서 «키째로» 사라지므로
 * 쓸 수 없다. 여기서는 저장된 값만으로 셈한다. 세금은 더하지 않는다 — 이 쇼핑몰은 라인
 * 세금이 붙지 않는다(tax_lines 가 비어 있다). 세금이 붙는 스토어를 지원하게 되면 여기가 바뀐다.
 * 값을 못 구하면 undefined 를 준다. 0 으로 채우면 ugc 가 「0원짜리 주문」으로 읽어 정률 보상이
 * 조용히 0원이 된다.
 */
export const lineAmount = (item: OrderLineInput): number | undefined => {
  const unitPrice = toNumber(item.unit_price);
  const quantity = toNumber(item.detail?.quantity);
  if (unitPrice === undefined || quantity === undefined) return undefined;

  const discount = (item.adjustments ?? []).reduce<number>((sum, adjustment) => {
    return sum + (toNumber(adjustment?.amount) ?? 0);
  }, 0);

  const amount = Math.round(unitPrice * quantity - discount);
  return amount >= 0 ? amount : undefined;
};

export const createReviewEligibilityStep = createStep(
  'create-review-eligibility',
  async (input: CreateReviewEligibilityInput, { container }) => {
    const ugcServiceUrl = process.env.UGC_SERVICE_URL;
    if (!ugcServiceUrl) {
      throw new Error('UGC_SERVICE_URL is not configured');
    }

    // ugc 의 리뷰자격 등록은 내부 전용 라우트다(바디의 userId 를 그대로 신뢰한다).
    // 키가 없으면 여기서 끊는다 — 헤더 없이 보내면 ugc 가 401 을 내고, 이 스텝은 워크플로의
    // step 2 라 실패가 step 1(결제 캡처) 롤백으로 번진다. 조용히 빠뜨리는 게 가장 위험하다.
    const ugcInternalKey = process.env.UGC_INTERNAL_KEY;
    if (!ugcInternalKey) {
      throw new Error('UGC_INTERNAL_KEY is not configured');
    }

    // customer metadata에서 almond_user_id 조회
    const query = container.resolve<RemoteQueryFunction>(ContainerRegistrationKeys.QUERY);
    const { data: customers } = await query.graph({
      entity: 'customer',
      fields: ['metadata'],
      filters: { id: input.customerId },
    });

    const almondUserId = customers?.[0]?.metadata?.almond_user_id;
    if (!almondUserId) {
      throw new Error(`No almond_user_id found for customer ${input.customerId}`);
    }

    const orderLines = input.items.filter((item) => item.id && item.product_id);

    if (!orderLines.length) {
      throw new Error(`No items found for order ${input.orderId}`);
    }

    // ugc 의 리뷰는 **PIM 마스터 id(UUID)** 로 키를 잡는다 — 상품 상세도 그 id 로 리뷰를 읽고
    // (`product.metadata.pimMasterId`), reviews.product_id 컬럼도 uuid 다. Medusa 의
    // product_id(prod_…) 를 그대로 넘기면 자격은 만들어져도 그 자격으로는 리뷰를 쓸 수 없다.
    const { data: products } = await query.graph({
      entity: 'product',
      fields: ['id', 'handle', 'metadata'],
      filters: { id: orderLines.map((item) => item.product_id) },
    });

    const masterIdByProductId = new Map<string, string>();
    for (const product of products ?? []) {
      const fromMetadata = (product?.metadata as Record<string, unknown> | null)?.pimMasterId;
      const masterId = typeof fromMetadata === 'string' && fromMetadata ? fromMetadata : product?.handle;
      if (product?.id && typeof masterId === 'string' && UUID_PATTERN.test(masterId)) {
        masterIdByProductId.set(product.id, masterId);
      }
    }

    const items = orderLines
      .map((item) => {
        const productId = masterIdByProductId.get(item.product_id);
        if (!productId) {
          logger.warn(
            `Review eligibility skipped: no PIM master id for product ${item.product_id} (order ${input.orderId})`,
          );
          return null;
        }

        const orderLineAmount = lineAmount(item);

        return {
          productId,
          orderLineId: item.id,
          ...(orderLineAmount === undefined ? {} : { orderLineAmount }),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    // 마스터 id 를 못 찾은 주문은 리뷰 자격 없이 넘어간다. 여기서 던지면 워크플로 step 1 —
    // 즉 **결제 캡처가 롤백**된다. 리뷰 자격이 없는 것보다 결제가 되돌려지는 쪽이 훨씬 나쁘다.
    if (!items.length) {
      logger.warn(`No PIM-backed items for order ${input.orderId}; skipping review eligibility`);
      return new StepResponse({ orderId: input.orderId, almondUserId });
    }

    const response = await fetch(`${ugcServiceUrl}/reviews/eligibilities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ugcInternalKey}`,
      },
      body: JSON.stringify({
        userId: almondUserId,
        orderId: input.orderId,
        items,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`UGC service returned ${response.status}: ${body}`);
    }

    logger.info(`Review eligibility created for order ${input.orderId}, user ${almondUserId}`);
    return new StepResponse({ orderId: input.orderId, almondUserId });
  },
);
