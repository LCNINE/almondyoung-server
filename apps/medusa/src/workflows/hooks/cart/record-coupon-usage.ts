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
 * 케이스다(JSDoc 이 `@ignore` 로 표시). `@ts-expect-error` 로 그 한 줄만 눌러 끈다 — 객체를
 * 다른 타입으로 캐스팅하지 않는 이유는, `no-duplicate-validate-hooks.unit.spec.ts` 의 가드가
 * 소스를 정규식 `(\w+Workflow)\.hooks\.(\w+)\(` 로 스캔하기 때문이다. `completeCartWorkflow`
 * `.hooks` 를 중간에서 캐스팅해 변수로 받으면, 실제 호출부의 「식별자 + .hooks. + 훅이름 + (」
 * 연속 패턴이 깨져 그 가드의 탐지망을 빠져나간다 — 나중에 누가 같은 훅을 또 등록해도 가드가
 * "중복 없음"으로 오판한다(실측: 캐스팅 변수를 썼더니 가드가 이 등록 자체를 못 셌다). 아래
 * 실제 호출은 그래서 캐스팅 없이, 원래 식별자 그대로 남겨 가드가 계속 이 등록을 셀 수 있게 한다.
 *
 * ⚠️ 이 주석 안에는 실제 호출부와 같은 문자열(식별자+.hooks.+훅이름+여는 괄호)을 그대로 적지
 * 말 것 — 가드는 파일 전체를 정규식으로 스캔하므로 주석에 있어도 매치로 잡혀 「같은 파일에
 * 두 번 등록」으로 오판해 이 가드 자체를 빨갛게 만든다(실측으로 재현했다).
 */
type OrderCreatedHookInput = { order_id: string; cart_id: string };
type HookContainer = { resolve: <T>(key: string) => T };
type OrderWithPromotions = {
  id: string;
  customer_id: string | null;
  promotions?: { id: string }[];
};

// @ts-expect-error — orderCreated 는 런타임엔 등록되지만 공개 .d.ts 엔 없다(위 설명 참고).
// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- 위와 같은 이유로 타입이 해석되지 않는다.
completeCartWorkflow.hooks.orderCreated(
  async ({ order_id }: OrderCreatedHookInput, { container }: { container: HookContainer }) => {
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
  },
);
