import { createWorkflow, transform, when, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import {
  acquireLockStep,
  createReservationsWorkflow,
  deleteReservationsWorkflow,
  releaseLockStep,
  updateReservationsWorkflow,
} from '@medusajs/medusa/core-flows';
import type { LineItemReservationRequest } from './plan';
import { planLineItemReservationsStep } from './steps';

export type SetLineItemReservationsInput = { items: LineItemReservationRequest[] };

/**
 * 줄 잠금. 이벤트 워커와 대사가 같은 줄을 동시에 설정하면, 둘 다 «예약 없음»을 읽고 둘 다 만들어 두 배가 된다.
 * 줄마다 키를 잡아 계획(읽기)과 쓰기를 한 덩어리로 줄 세운다.
 * - timeout 10s: 한 묶음(≤200줄) 쓰기는 수 초 안이다. 그보다 오래 기다리면 HTTP 호출이 먼저 끊긴다.
 * - ttl 60s: 프로세스가 죽어 해제를 못 해도 1분 뒤 풀린다. 실패 시 해제는 acquireLockStep 의 보상이 한다.
 * Medusa 예약 스텝이 잡는 키는 인벤토리 항목 id 라 이름이 겹치지 않는다.
 */
const LOCK = { timeout: 10, ttl: 60 };
const lockKeyOf = (lineItemId: string) => `line-item-reservation:${lineItemId}`;

/**
 * 줄마다 예약을 정확히 N(판매 단위)으로 맞춘다 — 워크플로 한 번 (#1247).
 *
 * 계획 → 만들기·고치기·지우기를 Medusa 예약 워크플로(`createReservationsWorkflow`·`updateReservationsWorkflow`·
 * `deleteReservationsWorkflow`)로 쓴다. 그 워크플로들이 `inventory_level.reserved_quantity` 를 같이 고치므로 캐시가
 * 예약 행과 어긋나지 않는다. 쓰기 중 하나가 실패하면 앞의 쓰기가 보상으로 되감긴다 — 반쯤 맞춘 묶음은 남지 않는다.
 *
 * 줄 단위 결과는 계획 단계가 정한다. 알려진 거절 사유(관리 대상 아님·위치 모호·레벨 없음·감소 금지)는 쓰기 전에
 * 걸러 그 줄만 결과에 적으므로 다른 줄의 쓰기를 막지 않는다. 그 밖의 실패로 묶음이 되감기면 라우트가 모든 줄을
 * `error` 로 돌려주고 호출자가 다시 시도한다.
 */
export const setLineItemReservationsWorkflow = createWorkflow(
  'set-line-item-reservations',
  (input: SetLineItemReservationsInput) => {
    const lockKeys = transform({ input }, ({ input }) =>
      [...new Set(input.items.map((item) => lockKeyOf(item.line_item_id)))].sort(),
    );
    acquireLockStep({ key: lockKeys, ...LOCK });

    const plan = planLineItemReservationsStep({ items: input.items });

    // `when` 은 중첩하면 부팅이 죽는다(`customers/withdraw-customer.ts` 주석) — 나란히만 둔다.
    // 빈 묶음으로 예약 워크플로를 부르지 않는다: create 의 레벨 조회가 빈 조건으로 돈다.
    when({ plan }, ({ plan }) => plan.creates.length > 0).then(() => {
      createReservationsWorkflow.runAsStep({
        input: { reservations: transform({ plan }, ({ plan }) => plan.creates) },
      });
    });
    when({ plan }, ({ plan }) => plan.updates.length > 0).then(() => {
      updateReservationsWorkflow.runAsStep({
        input: { updates: transform({ plan }, ({ plan }) => plan.updates) },
      });
    });
    when({ plan }, ({ plan }) => plan.deletes.length > 0).then(() => {
      deleteReservationsWorkflow.runAsStep({
        input: { ids: transform({ plan }, ({ plan }) => plan.deletes) },
      });
    });

    releaseLockStep({ key: lockKeys });

    return new WorkflowResponse(transform({ plan }, ({ plan }) => plan.results));
  },
);
