import { createWorkflow, transform, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import { acquireLockStep, releaseLockStep } from '@medusajs/medusa/core-flows';
import type { BundleOfferSyncItem } from './rules';
import { prepareBundleOfferSyncStep, replaceBundleOffersStep } from './steps';

/**
 * 상품(A) 하나의 함께 구매 구성품 전체 교체. 같은 상품의 동기화가 겹치면 옛 행을 둘 다 읽고 새 행을 두 벌 만들 수 있어
 * 상품 단위로 잠근다. 구성품이 쇼핑몰에 없으면 그 줄만 빠지고 결과의 skipped 에 남는다.
 * 이미 더 늦은 교체(core 저장 시각)가 적용됐으면 아무것도 바꾸지 않고 stale 을 돌려준다.
 */
export const syncProductBundleOffersWorkflow = createWorkflow(
  'sync-product-bundle-offers',
  (input: { product_id: string; pim_master_id: string; offers: BundleOfferSyncItem[]; changed_at?: string }) => {
    const lockKey = transform({ input }, ({ input }) => `bundle-offer:${input.product_id}`);
    acquireLockStep({ key: lockKey, timeout: 10, ttl: 30 });
    const plan = prepareBundleOfferSyncStep({ product_id: input.product_id, offers: input.offers });
    const replaced = replaceBundleOffersStep(
      transform({ input, plan }, ({ input, plan }) => ({ product_id: input.product_id, rows: plan.rows, changed_at: input.changed_at })),
    );
    releaseLockStep({ key: lockKey });
    return new WorkflowResponse(transform({ plan, replaced }, ({ plan, replaced }) => ({ skipped: plan.skipped, stale: replaced.stale })));
  },
);
