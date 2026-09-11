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

/**
 * 무엇을 했는지 «호출자가 읽을 수 있게» 돌려준다. 던지는 대신 이걸로 말한다 —
 * 자동 구매확정 잡이 「자격이 실제로 생겼나」를 판정하려면 결과가 필요하다.
 */
export type CreateReviewEligibilityResult =
  | { status: 'created'; orderId: string; almondUserId: string; itemCount: number }
  | { status: 'skipped'; orderId: string; reason: string };

/**
 * ugc 왕복 상한. 없으면 ugc 가 매달릴 때 «결제 워크플로가 같이 매달린다» — 결제 경로다.
 */
const UGC_REQUEST_TIMEOUT_MS = 5_000;

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

/**
 * 🔴 **이 함수는 던지지 않는다.**
 *
 * 구매확정 워크플로에서 이건 step 2 이고, 던지면 step 1(결제 캡처)의 보상 함수가 돌아
 * `refundPaymentWorkflow` 로 «실제 환불»이 나간다. 리뷰 자격이 없는 것보다 고객 결제가
 * 되돌려지는 쪽이 비교할 수 없이 나쁘고, 자동 구매확정 잡은 이 경로를 대량으로 밟으므로
 * ugc 장애 한 번이 다발 환불이 된다. 그래서 모든 실패는 로그 + 조기 반환이다.
 *
 * 대신 자격이 «조용히 누락»될 수 있다 — 그건 발급이 멱등(`source_event_id` unique +
 * `onConflictDoNothing`)이라는 점에 기대어 나중에 다시 시도해 메운다.
 */
export async function createReviewEligibility(
  input: CreateReviewEligibilityInput,
  container: { resolve: <T>(key: string) => T },
): Promise<CreateReviewEligibilityResult> {
  const skip = (reason: string, detail?: string): CreateReviewEligibilityResult => {
    logger.warn(`Review eligibility skipped for order ${input.orderId}: ${reason}${detail ? ` — ${detail}` : ''}`);
    return { status: 'skipped', orderId: input.orderId, reason };
  };

  const ugcServiceUrl = process.env.UGC_SERVICE_URL;
  if (!ugcServiceUrl) return skip('ugc_service_url_missing');

  // ugc 의 리뷰자격 등록은 내부 전용 라우트다(바디의 userId 를 그대로 신뢰한다).
  // 키가 없으면 보내 봐야 401 이므로 여기서 끊는다.
  const ugcInternalKey = process.env.UGC_INTERNAL_KEY;
  if (!ugcInternalKey) return skip('ugc_internal_key_missing');

  const orderLines = input.items.filter((item) => item.id && item.product_id);
  if (!orderLines.length) return skip('no_items');

  let almondUserId: string;
  let items: Array<{ productId: string; orderLineId: string; orderLineAmount?: number }>;

  try {
    // customer metadata에서 almond_user_id 조회
    const query = container.resolve<RemoteQueryFunction>(ContainerRegistrationKeys.QUERY);
    const { data: customers } = await query.graph({
      entity: 'customer',
      fields: ['metadata'],
      filters: { id: input.customerId },
    });

    const resolvedUserId = customers?.[0]?.metadata?.almond_user_id;
    if (!resolvedUserId) return skip('no_almond_user_id', `customer ${input.customerId}`);
    almondUserId = resolvedUserId as string;

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

    items = orderLines
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
  } catch (err) {
    return skip('lookup_failed', (err as Error)?.message);
  }

  if (!items.length) return skip('no_pim_backed_items');

  try {
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
      signal: AbortSignal.timeout(UGC_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return skip(`ugc_error_${response.status}`, body);
    }
  } catch (err) {
    return skip('ugc_request_failed', (err as Error)?.message);
  }

  logger.info(`Review eligibility created for order ${input.orderId}, user ${almondUserId}`);
  return { status: 'created', orderId: input.orderId, almondUserId, itemCount: items.length };
}

export const createReviewEligibilityStep = createStep(
  'create-review-eligibility',
  async (input: CreateReviewEligibilityInput, { container }) => {
    const result = await createReviewEligibility(input, container as { resolve: <T>(key: string) => T });
    return new StepResponse(result);
  },
);
