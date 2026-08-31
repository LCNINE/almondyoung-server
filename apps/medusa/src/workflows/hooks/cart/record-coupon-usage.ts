import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { completeCartWorkflow } from '@medusajs/medusa/core-flows';
import { buildUsageLinks } from './coupon-usage';

/**
 * 주문이 생기면 「이 주문에 쓰인 쿠폰」을 링크 행에 남긴다 (#488 N4 → A2 의 선행).
 *
 * `completeCartWorkflow.hooks.orderCreated` 는 이 저장소에서 아직 아무도 쓰지 않던 자리다
 * (`validate` 는 `complete-cart.ts` 가 이미 쓴다 — 워크플로당 핸들러는 하나뿐이므로 새 훅을
 * 등록할 때는 반드시 빈 자리인지 확인할 것).
 *
 * 실패해도 주문을 되돌리지 않는다 — 기록은 부가정보이고, 그것 때문에 결제된 주문을 롤백하면
 * 손해가 훨씬 크다. (`apply-promotion-meta` 의 발급 로그 정리와 같은 판단이다.)
 *
 * ⚠️ 훅 입력은 `{ order }` 가 아니라 `{ order_id, cart_id }` 다 — `complete-cart.js` 의
 * `createHook("orderCreated", { order_id: createdOrder.id, cart_id: cartData.data.id })` 가
 * 실제로 넘기는 payload 를 그대로 따른다(실측, node_modules 소스 확인). `{ order }` 로
 * 구조분해하면 매 주문마다 `undefined` 가 되어 아래 catch 가 조용히 삼킨다 — 기록이 한 번도
 * 안 남는데 아무 데도 안 보인다.
 *
 * ⚠️ `completeCartWorkflow.hooks` 의 공개 타입(`complete-cart.d.ts`)은 `validate` 하나만
 * 노출한다. 하지만 `orderCreated` 는 워크플로 본문에서 실제로 `createHook("orderCreated", …)`
 * 로 등록되고, `mainFlow.hooks[hook]` 이 그 등록 목록을 그대로 순회해 채운다
 * (`workflows-sdk/create-workflow.js` 실측) — 즉 **런타임엔 존재하는데 타입 선언에서만 빠진**
 * 케이스다(JSDoc 이 `@ignore` 로 표시). 그래서 이 한 줄에서만 타입을 좁혀 캐스팅한다.
 */
type OrderCreatedHookInput = { order_id: string; cart_id: string };
type HookContainer = { resolve: <T>(key: string) => T };
type OrderWithPromotions = {
  id: string;
  customer_id: string | null;
  promotions?: { id: string }[];
};
const hooks = completeCartWorkflow.hooks as unknown as {
  orderCreated: (invoke: (input: OrderCreatedHookInput, ctx: { container: HookContainer }) => Promise<void>) => void;
};

hooks.orderCreated(async ({ order_id }, { container }) => {
  try {
    const query = container.resolve<{
      graph: (args: unknown) => Promise<{ data: OrderWithPromotions[] }>;
    }>(ContainerRegistrationKeys.QUERY);
    const link = container.resolve<{ create: (payloads: unknown[]) => Promise<unknown> }>(
      ContainerRegistrationKeys.LINK,
    );

    const { data: orders } = await query.graph({
      entity: 'order',
      fields: ['id', 'customer_id', 'promotions.id'],
      filters: { id: order_id },
    });
    const found = orders?.[0];
    const promotionIds = (found?.promotions ?? []).map((p) => p.id);

    const payloads = buildUsageLinks(found?.customer_id, promotionIds, order_id, new Date());
    if (payloads.length) await link.create(payloads);
  } catch (e) {
    const logger = container.resolve<{ error: (msg: string) => void }>(ContainerRegistrationKeys.LOGGER);
    logger.error(`[coupon] 사용 기록 실패 (주문은 유지): ${(e as Error)?.message}`);
  }
});
