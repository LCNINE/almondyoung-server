import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { logger } from '@medusajs/framework';
import type { RemoteQueryFunction } from '@medusajs/framework/types';

type CreateReviewEligibilityInput = {
  customerId: string;
  orderId: string;
  items: Array<{ id: string; product_id: string }>;
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

    const items = input.items
      .filter((item) => item.id && item.product_id)
      .map((item) => ({
        productId: item.product_id,
        orderLineId: item.id,
      }));

    if (!items.length) {
      throw new Error(`No items found for order ${input.orderId}`);
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
