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
 * 줄 예약 쓰기 전체를 직렬화하는 키 하나(선례: 타임세일·수량 할인 쓰기 잠금).
 *
 * 이벤트 워커와 대사가 같은 줄을 동시에 설정하면 둘 다 «예약 없음»을 읽고 둘 다 만들어 두 배가 된다.
 * 줄마다 키를 잡지 않는다: 여러 키 잠금은 키를 병렬로 잡아, 하나가 막히면 이미 잡은 키가 만료까지 남고
 * ownerId 가 없는 재시도는 자기 키도 다시 못 잡는다(묶음끼리 교착). 묶음이 줄 서는 대가는 받아들인다 —
 * 호출은 1분 단위 워커와 하루 한 번 대사뿐이다.
 * - timeout 30s: 앞선 묶음 하나(≤200줄, 수 초)를 기다리기엔 넉넉하고, 그보다 길면 HTTP 호출이 먼저 끊긴다.
 * - ttl 120s: 프로세스가 죽어 해제를 못 해도 2분 뒤 풀린다. 실패 시 해제는 acquireLockStep 의 보상이 한다.
 * ownerId 는 주지 않는다(타임세일 잠금 주석과 같은 이유). Medusa 예약 스텝이 잡는 키는 인벤토리 항목 id 라 겹치지 않는다.
 */
const LINE_ITEM_RESERVATION_WRITE_LOCK = { key: 'line-item-reservation:write', timeout: 30, ttl: 120 };

/**
 * 줄마다 예약을 정확히 N(판매 단위)으로 맞춘다 — 워크플로 한 번 (#1247).
 *
 * 계획 → 만들기·고치기·지우기를 Medusa 예약 워크플로(`createReservationsWorkflow`·`updateReservationsWorkflow`·
 * `deleteReservationsWorkflow`)로 쓴다. 그 워크플로들이 `inventory_level.reserved_quantity` 를 같이 고치므로 캐시가
 * 예약 행과 어긋나지 않는다. 쓰기 중 하나가 실패하면 앞의 쓰기가 보상으로 되감긴다 — 반쯤 맞춘 묶음은 남지 않는다.
 *
 * 줄 단위 결과는 계획 단계가 정한다. 알려진 거절 사유(관리 대상 아님·위치 모호·레벨 없음·감소 금지)는 쓰기 전에
 * 걸러 그 줄만 결과에 적으므로 다른 줄의 쓰기를 막지 않는다. 그 밖의 실패로 묶음이 되감기면 라우트가 계획을
 * 다시 읽어 쓰기가 계획됐던 줄만 `error` 로 돌려주고(`resultsAfterWriteFailure`) 호출자가 다시 시도한다.
 */
export const setLineItemReservationsWorkflow = createWorkflow(
  'set-line-item-reservations',
  (input: SetLineItemReservationsInput) => {
    acquireLockStep(LINE_ITEM_RESERVATION_WRITE_LOCK);

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

    releaseLockStep({ key: LINE_ITEM_RESERVATION_WRITE_LOCK.key });

    return new WorkflowResponse(transform({ plan }, ({ plan }) => plan.results));
  },
);
