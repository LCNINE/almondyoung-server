import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';
import { PROMOTION_META_MODULE } from '../modules/promotion-meta';
import type PromotionMetaModuleService from '../modules/promotion-meta/service';

/**
 * 주문이 취소되면 그 주문에 쓰인 쿠폰 «장» 을 되돌린다 (#488 A2).
 *
 * A2 는 추상적 서술이 아니었다 — 1인당 한도 2/2 를 쓴 뒤 두 주문 모두 취소+전액 환불했는데
 * `campaign_budget_usage` 가 2 그대로라 고객 목록에서 쿠폰이 영구히 사라졌다(리허설 1차 실측).
 * 그 한도를 안 쓰게 되면서(설계 §5.3) 복구 대상이 우리 테이블로 내려왔다.
 *
 * ⚠️ 이 워크플로 훅이 아니라 **구독자**인 이유: `order.canceled` 에는 이미 구독자가 둘 붙어
 * 있고(welcome-membership-order · membership-benefit-order), 구독자는 훅과 달리 개수 제한이 없다.
 *
 * ⚠️ 만료된 장은 되살리지 않는다 — 되살려도 못 쓰고 「돌아왔는데 못 쓴다」가 더 나쁘다.
 * `restoreGrantsByOrder` 가 그 판정을 갖고 있다.
 */
export default async function handleCouponGrantRestore({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = data?.id;
  if (!orderId) return;

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const promotionMetaService = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  try {
    const restored = await promotionMetaService.restoreGrantsByOrder(orderId, new Date());
    if (restored > 0) {
      logger.info(`[coupon] 주문 취소로 쿠폰 ${restored}장 복구 (order_id=${orderId})`);
    }
  } catch (e: any) {
    // 복구 실패가 취소를 막아서는 안 된다. 다만 조용히 넘기면 고객이 쿠폰을 잃은 채 남는다.
    logger.error(
      `[coupon] 쿠폰 장 복구 실패 (order_id=${orderId}): ${e?.message ?? e}. ` +
        'coupon_grant 에서 이 order_id 를 찾아 used_at/order_id 를 수동으로 비울 것.',
    );
  }
}

export const config: SubscriberConfig = {
  event: 'order.canceled',
  context: { subscriberId: 'coupon-grant-restore-handler' },
};
