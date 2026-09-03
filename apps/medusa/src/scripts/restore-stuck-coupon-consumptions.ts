import type { ExecArgs, MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../modules/promotion-meta';
import type PromotionMetaModuleService from '../modules/promotion-meta/service';

/**
 * «주문 없는 소모» 스위퍼 (ADR-0034 2026-09-04 개정, 결정 7).
 *
 * 소모는 `completeCartWorkflow` 의 `validate` 훅에서 커밋된다. 그 뒤 워크플로가 끝나기 전(수 초)에
 * Medusa 프로세스가 죽으면 장은 «카트가 잡았는데 주문은 없는» 채로 남는다 — 보상은 살아 있는
 * 프로세스만 돌린다. 같은 카트의 재시도는 `already` 로 스스로 낫지만, 고객이 카트를 버리면
 * 이 잡이 유일한 복구 경로다. 옛 구조(주문 뒤 훅)의 같은 창은 고객에게 유리한 방향이었고 새
 * 구조는 불리한 방향이라, 이 잡은 선택이 아니라 결정의 일부다.
 *
 * 판정: 후보(`listStuckConsumptions` — 카트가 잡았고 `minAge` 보다 오래된 사용된 장) 중
 * `order_cart` 링크가 **없고** 카트가 **완료되지 않은**(또는 카트 행이 없는) 것만 되돌린다. 둘 중
 * 하나라도 «주문이 있다» 고 말하면 놓지 않는다.
 *
 * 환경변수: COUPON_STUCK_MIN_AGE_MINUTES (기본 60) — 이보다 최근 소모는 진행 중일 수 있어 건드리지 않는다.
 * `completeCartWorkflow` 의 카트 락 TTL 은 2분이고 완료는 수 초라 60분은 넉넉하다.
 *
 * 중복 실행 주의(`orphan-payment-reconcile` 과 같다): 다중 인스턴스면 인스턴스마다 돈다.
 * `restoreGrants` 는 `used_at IS NOT NULL` 술어라 두 번 돌아도 결과가 같다.
 */
export type StuckSweepSummary = { scanned: number; restored: number; kept: number };

/** 한 회차에 훑는 후보 상한. 상한에 걸리면 경고를 남긴다 — 다음 회차가 이어서 훑는다. */
const SCAN_LIMIT = 500;

function minAgeMs(): number {
  const raw = Number(process.env.COUPON_STUCK_MIN_AGE_MINUTES);
  return (Number.isFinite(raw) && raw > 0 ? raw : 60) * 60_000;
}

export async function restoreStuckCouponConsumptions(
  container: MedusaContainer,
  opts: { minAgeMs?: number; limit?: number; now?: Date } = {},
): Promise<StuckSweepSummary> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const service = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const now = opts.now ?? new Date();
  const limit = opts.limit ?? SCAN_LIMIT;
  const usedBefore = new Date(now.getTime() - (opts.minAgeMs ?? minAgeMs()));

  const candidates = await service.listStuckConsumptions(usedBefore, limit);
  if (candidates.length === 0) return { scanned: 0, restored: 0, kept: 0 };

  const cartIds = [...new Set(candidates.map((c) => c.cart_id))];
  const { data: links } = await query.graph({
    entity: 'order_cart',
    fields: ['cart_id', 'order_id'],
    filters: { cart_id: cartIds },
  });
  const withOrder = new Set((links ?? []).map((l: { cart_id: string }) => l.cart_id));

  const { data: carts } = await query.graph({
    entity: 'cart',
    fields: ['id', 'completed_at'],
    filters: { id: cartIds },
  });
  const completed = new Set(
    (carts ?? []).filter((c: { completed_at: Date | null }) => c.completed_at != null).map((c: { id: string }) => c.id),
  );

  const stuck = candidates.filter((c) => !withOrder.has(c.cart_id) && !completed.has(c.cart_id));
  const restored = await service.restoreGrants(stuck.map((c) => c.id));

  if (restored > 0) {
    const stuckCarts = [...new Set(stuck.map((c) => c.cart_id))].join(',');
    logger.warn(`[coupon] 주문 없는 소모 ${restored}장 되돌림 (cart_id=${stuckCarts})`);
  }
  if (candidates.length >= limit) {
    logger.warn(`[coupon] 스위퍼 후보가 상한(${limit})에 걸렸다 — 다음 회차가 이어서 훑는다`);
  }
  return { scanned: candidates.length, restored, kept: candidates.length - stuck.length };
}

/** `medusa exec ./src/scripts/restore-stuck-coupon-consumptions.ts` — 잡과 같은 동작을 손으로 돌린다. */
export default async function ({ container }: ExecArgs) {
  const summary = await restoreStuckCouponConsumptions(container);
  container.resolve(ContainerRegistrationKeys.LOGGER).info(`[coupon] 스위퍼 ${JSON.stringify(summary)}`);
}
