import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { completeCartWorkflow } from '@medusajs/medusa/core-flows';
import { PROMOTION_META_MODULE } from '../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../modules/promotion-meta/service';
import { selectGrantIdsToConsume } from './coupon-usage';

/**
 * 주문이 생기면 「이 주문에 쓰인 쿠폰」의 장(coupon_grant)을 소모한다 (#488 A2 의 선행, G5~G7).
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
      const promotionMetaService = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

      const { data: orders } = await query.graph({
        entity: 'order',
        fields: ['id', 'customer_id', 'promotions.id'],
        filters: { id: order_id },
      });
      const found = orders?.[0];

      // C1(2026-08-31 최종 리뷰)이 지키던 불변식("발급된 적 없는 쌍은 절대 만들지 않는다")은
      // 링크 upsert 를 grant 소모(id 로 UPDATE)로 옮기면서 **구조적으로** 성립한다 — 발급받지
      // 않은 쿠폰은 `listGrantsForCustomer` 가 애초에 행을 안 돌려주므로 `selectGrantIdsToConsume`
      // 이 고를 장 자체가 없다. 없는 쌍에 INSERT 가 일어날 경로가 이제 없다(coupon-usage.ts 상단
      // 주석 참고). 그래서 옛 구현이 필요로 했던 「이미 발급된 것만」 필터가 여기엔 없다.
      const grants = found?.customer_id ? await promotionMetaService.listGrantsForCustomer(found.customer_id) : [];
      const now = new Date();
      const promotionIds = (found?.promotions ?? []).map((p) => p.id);
      // order_id 를 넘겨 재실행 멱등성을 지킨다(coupon-usage.ts 상단 주석 참고) — 이 훅이 같은
      // 주문으로 두 번 불려도 이미 이 주문이 소모한 프로모션은 다시 고르지 않는다.
      const grantIds = selectGrantIdsToConsume(grants, promotionIds, now, order_id);

      for (const grantId of grantIds) {
        const consumed = await promotionMetaService.consumeGrantIfUnused(grantId, order_id, now);
        if (!consumed) {
          // 이 장을 그 사이에 다른 주문이 먼저 소모했거나 회수됐다. 주문은 이미 생겼으니
          // 되돌리지 않되(위 주석의 판단 그대로), 흔적은 남긴다.
          //
          // 🔴 옛 구현은 조건 없는 UPDATE 라 이 경우를 «성공» 으로 삼켰다 — 한 장이 두 주문에
          // 쓰이고 `order_id` 는 나중 것만 남았다. 이제 술어가 SQL 에 있어 두 번째 소모가
          // 0행으로 떨어지고, 여기서 그 사실이 드러난다.
          try {
            container
              .resolve<{ warn: (msg: string) => void }>(ContainerRegistrationKeys.LOGGER)
              .warn(
                `[coupon] 장 소모 실패 — 이미 사용됐거나 회수된 장이다 ` +
                  `(grant_id=${grantId}, order_id=${order_id}). 이 주문은 그 장으로 기록되지 않는다.`,
              );
          } catch {
            // 로그를 못 남겨도 나머지 장의 소모는 계속한다 — 위 I1 판단과 같은 이유로,
            // 기록 실패가 주문 경로를 건드리게 두지 않는다.
          }
        }
      }
    } catch (e) {
      // I1(2026-08-31 최종 리뷰): LOGGER 해석 자체가 던지는 경우까지 이 catch 밖으로 새면,
      // orderCreated 는 authorizePaymentSessionStep 뒤에 도는 훅이라 이미 성공한 결제 승인·
      // 주문 생성을 보상(롤백)시킨다 — 이 catch 가 막으려던 바로 그 사고다. 그래서 여기
      // 안에서도 절대 던지지 않는다(LOGGER 는 핵심 인프라라 사실상 항상 성공하지만, 그
      // "거의 항상"에 결제 롤백을 걸 수는 없다).
      try {
        const logger = container.resolve<{ error: (msg: string) => void }>(ContainerRegistrationKeys.LOGGER);
        logger.error(`[coupon] 사용 기록 실패 (주문은 유지): ${(e as Error)?.message}`);
      } catch {
        // LOGGER 조차 못 얻으면 조용히 삼킨다 — 기록 실패를 기록할 방법이 없을 뿐, 주문은 지킨다.
      }
    }
  },
);
