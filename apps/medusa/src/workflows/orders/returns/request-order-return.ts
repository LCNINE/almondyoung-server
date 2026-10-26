import { createHash } from 'crypto';
import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules, ReturnStatus } from '@medusajs/framework/utils';
import {
  beginReturnOrderWorkflow,
  cancelReturnRequestWorkflow,
  confirmReturnRequestWorkflow,
  createReturnShippingMethodWorkflow,
  requestItemReturnWorkflow,
} from '@medusajs/medusa/core-flows';

import { findReturnShippingOptionId } from '../../../modules/almond-fulfillment/return-shipping-option';
import { describeError } from '../../../utils/describe-error';
import { orderCancelLockKey } from '../settlement/order-payments';
import { fetchCoreReturnEligibility } from './core-return-eligibility';
import { loadReturnOrder, RETURN_REQUEST_METADATA_KEY, type ReturnRequestRecord } from './load-return-order';
import { planReturnRequest, ReturnRequestRejected, type ReturnRequestedBy } from './plan-return-request';
import { readReturnFeeBearer, RETURN_REASON_CUSTOMER_SELECTABLE_KEY } from './return-reasons';

export type RequestOrderReturnInput = {
  orderId: string;
  /** 호출자가 정한 멱등 키(N5) — 같은 주문에 같은 값의 반품이 있으면 새로 만들지 않는다 */
  requestId: string;
  items: Array<{ itemId: string; quantity: number }>;
  /** 반품 사유 value(RETURN_REASONS). 반품 하나에 사유 하나(N6) */
  reasonValue: string;
  note?: string;
  requestedBy: ReturnRequestedBy;
  /** requestedBy 가 customer 면 필수 — 주문 주인이 아니면 «없는 주문»으로 닫는다 */
  customerId?: string;
  /** 사유가 operator(기타)일 때 CS 가 고른 택배비 부담 주체 */
  operatorFeeBearer?: 'customer' | 'seller';
  windowOverrideReason?: string;
  actorId?: string;
  now?: Date;
};

export type RequestOrderReturnResult = {
  returnId: string;
  requestId: string;
  status: string;
  items: Array<{ itemId: string; quantity: number }>;
  feeBearer: 'customer' | 'seller';
  windowOverridden: boolean;
};

/** 주문이 없거나 남의 것이다. 호출자는 404 로 닫는다 — 존재 여부를 흘리지 않게 두 경우를 가르지 않는다(N7). */
export class ReturnOrderNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReturnOrderNotFound';
  }
}

/** 부분취소와 같은 잠금 — 한 주문에 열린 주문 변경은 하나뿐이다(N5). 레디스 잠금은 timeout 이 곧 만료다. */
const ORDER_LOCK_TIMEOUT_SECONDS = 60;

/**
 * 반품 요청(K8 PR3, 설계 §4.2 «우리 워크플로 셋»의 1).
 *
 * 배송완료 수량은 core 가 정하고(N2), 판정은 planReturnRequest 한 곳이 한다. Medusa 는 출고를 몰라 fulfilled_quantity 가
 * 0 이므로, 반품이 잡는 수량만큼만 registerFulfillment 로 올린 뒤(N1) 코어 반품 워크플로를 차례로 부른다. 반품 배송 방법은
 * 0원이다 — 택배비는 요청 때 매기지 않고 부담 주체만 기록에 남긴다(정산은 PR 6).
 */
export async function requestOrderReturn(container: MedusaContainer, input: RequestOrderReturnInput): Promise<RequestOrderReturnResult> {
  const locking = container.resolve(Modules.LOCKING);
  return locking.execute(orderCancelLockKey(input.orderId), () => run(container, input), {
    timeout: ORDER_LOCK_TIMEOUT_SECONDS,
  });
}

async function run(container: MedusaContainer, input: RequestOrderReturnInput): Promise<RequestOrderReturnResult> {
  const order = await loadReturnOrder(container, input.orderId);
  if (!order || (input.requestedBy === 'customer' && (!input.customerId || order.customerId !== input.customerId))) {
    throw new ReturnOrderNotFound(`주문을 찾을 수 없습니다: ${input.orderId}`);
  }

  // 멱등은 판정 «전»에 본다 — 같은 요청을 다시 판정하면 이미 만든 반품이 그 수량을 잡고 있어 quantity_exceeds_returnable 로 거절된다
  const items = normalizeItems(input.items);
  const requestHash = hashReturnRequest(items, input.reasonValue, input.operatorFeeBearer);
  const existing = order.returns.find((r) => r.record?.requestId === input.requestId);
  if (existing?.record) {
    if (existing.record.requestHash !== requestHash) {
      throw new ReturnRequestRejected('request_id_conflict', `같은 requestId 로 다른 요청이 왔습니다: ${input.requestId}`);
    }
    // 해시가 품목을 덮으므로 이번 품목이 곧 그때 품목이다
    return toResult(existing.id, existing.status, input.requestId, items, existing.record);
  }

  const core = await fetchCoreReturnEligibility(order.id);
  const reasonRow = await findReturnReason(container, input.reasonValue);
  const plan = planReturnRequest({
    orderStatus: order.status,
    items: order.items,
    core,
    requested: items,
    requestedBy: input.requestedBy,
    reason: reasonRow && {
      value: reasonRow.value,
      feeBearer: readReturnFeeBearer(reasonRow),
      customerSelectable: reasonRow.metadata?.[RETURN_REASON_CUSTOMER_SELECTABLE_KEY] === true,
    },
    operatorFeeBearer: input.operatorFeeBearer,
    windowOverrideReason: input.windowOverrideReason,
    now: input.now ?? new Date(),
  });
  // planReturnRequest 가 사유 없음을 이미 거절했다 — 타입을 좁히려고 한 번 더 본다
  if (!reasonRow) throw new ReturnRequestRejected('reason_not_found', '반품 사유를 찾을 수 없습니다');

  const target = await returnTarget(container);

  const record: ReturnRequestRecord = {
    requestId: input.requestId,
    requestHash,
    requestedBy: input.requestedBy,
    reasonValue: reasonRow.value,
    feeBearer: plan.feeBearer,
    windowOverride: plan.windowOverridden
      ? { reason: (input.windowOverrideReason ?? '').trim(), actorId: input.actorId ?? null }
      : null,
    fulfillmentTopUp: plan.fulfillmentTopUp,
  };

  // N1 — 코어 RETURN_ITEM 은 quantity ≤ fulfilled − return_requested 를 요구하는데 Medusa 는 출고를 몰라 fulfilled 가 0 이다.
  // 반품이 잡는 수량만큼만 올린다: 전부 올리면 부분취소(item-update)가 그 아래로 수량을 못 줄인다. registerFulfillment 는
  // 주문 변경을 만들고 곧바로 확정할 뿐 fulfillment 레코드·재고·provider 를 건드리지 않는다. 올린 값은 기록에 남아 반품 취소가 되돌린다.
  const orderModule = container.resolve(Modules.ORDER);
  const topUp = plan.fulfillmentTopUp.map((t) => ({ id: t.itemId, quantity: t.quantity }));
  // internal_note 는 주문 변경 이력에서 이 출고 수량이 어느 반품 요청의 것인지 찾는 표지다 — 여기서 프로세스가 죽으면 기록 없이 남는다
  if (topUp.length > 0) {
    await orderModule.registerFulfillment({
      order_id: order.id,
      items: topUp,
      created_by: input.actorId,
      internal_note: `return-request:${input.requestId}`,
    });
  }

  let returnId: string | undefined;
  try {
    const { result: change } = await beginReturnOrderWorkflow(container).run({
      input: {
        order_id: order.id,
        location_id: target.locationId,
        created_by: input.actorId,
        metadata: { [RETURN_REQUEST_METADATA_KEY]: record },
      },
    });
    returnId = change.return_id ?? undefined;
    if (!returnId) throw new Error(`반품 주문 변경에 return_id 가 없습니다: ${order.id}`);

    await requestItemReturnWorkflow(container).run({
      input: {
        return_id: returnId,
        // 코어 2.13.4 는 품목의 note 를 버리고 internal_note 를 반품 품목의 note 로 옮긴다(create-return-items-from-actions.js:17).
        // 고객이 쓴 메모가 반품 품목에 남도록 internal_note 로 넘긴다 — 같은 값이 주문 변경 이력에도 남는다.
        items: plan.items.map((i) => ({
          id: i.itemId,
          quantity: i.quantity,
          reason_id: reasonRow.id,
          ...(input.note ? { internal_note: input.note } : {}),
        })),
      },
    });
    await createReturnShippingMethodWorkflow(container).run({
      input: { return_id: returnId, shipping_option_id: target.optionId, custom_amount: 0 },
    });
    await confirmReturnRequestWorkflow(container).run({ input: { return_id: returnId, confirmed_by: input.actorId } });
  } catch (error) {
    await rollback(container, { orderId: order.id, returnId, topUp });
    throw error instanceof Error ? error : new Error(`반품 요청 실패: ${describeError(error)}`);
  }

  return toResult(returnId, ReturnStatus.REQUESTED, input.requestId, plan.items, record);
}

/**
 * 확정 전 실패의 되돌리기 — 반품(열린 주문 변경 포함)을 «먼저» 버리고 올린 출고 수량을 «나중»에 내린다.
 * 순서가 거꾸로면 cancelFulfillment 가 새 주문 변경을 만들다 «열린 주문 변경이 이미 있다»로 거절돼 fulfilled 가 올라간 채 남는다.
 * 되돌리기 실패는 삼키고(원래 오류가 호출자에게 가야 한다) 로그로만 남긴다 — 남은 흔적은 사람이 볼 수 있어야 한다.
 */
async function rollback(
  container: MedusaContainer,
  p: { orderId: string; returnId: string | undefined; topUp: Array<{ id: string; quantity: number }> },
) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  if (p.returnId) {
    await cancelReturnRequestWorkflow(container)
      .run({ input: { return_id: p.returnId } })
      .catch((e: unknown) =>
        logger.error(`[return-request] 반품 되돌리기 실패: orderId=${p.orderId} returnId=${p.returnId} — ${describeError(e)}`),
      );
  }
  if (p.topUp.length > 0) {
    await container
      .resolve(Modules.ORDER)
      .cancelFulfillment({ order_id: p.orderId, items: p.topUp })
      .catch((e: unknown) =>
        logger.error(
          `[return-request] 올린 출고 수량 되돌리기 실패: orderId=${p.orderId} items=${JSON.stringify(p.topUp)} — ${describeError(e)}`,
        ),
      );
  }
}

async function findReturnReason(container: MedusaContainer, value: string) {
  const [row] = await container.resolve(Modules.ORDER).listReturnReasons({ value });
  return row ?? null;
}

/** 반품 배송 옵션과 그 위치. 시드가 빠졌으면 조용히 깨지지 않게 크게 남기고 정해진 거절로 닫는다(설계 §4.2). */
async function returnTarget(container: MedusaContainer): Promise<{ optionId: string; locationId: string }> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const optionId = await findReturnShippingOptionId(container);
  if (!optionId) {
    logger.error('[return-request] 반품 배송 옵션이 없다 — seed-shipping 확인');
    throw new ReturnRequestRejected('return_option_missing', '반품을 접수할 수 없습니다(반품 배송 옵션 없음)');
  }
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'shipping_option',
    fields: ['id', 'service_zone.fulfillment_set.location.id'],
    filters: { id: optionId },
  });
  // 링크 필드(fulfillment_set.location)는 graph 결과 타입에 없다 — 경계에서 좁힌다.
  const [option] = data as Array<{ service_zone?: { fulfillment_set?: { location?: { id?: string } | null } | null } | null }>;
  // 반품 위치 = 반품 옵션의 위치. confirmReturnReceive 가 이 위치의 재고 level 을 올리고, 반품 fulfillment 도 이 위치로 간다.
  // 라이브 stock location 은 하나뿐이고(설계 §4.4-4) 그게 판매 위치이기도 해서 재고 관리 variant 의 level 이 거기 있다.
  const locationId = option?.service_zone?.fulfillment_set?.location?.id;
  if (!locationId) {
    logger.error(`[return-request] 반품 배송 옵션에 위치가 없다 — seed-shipping 확인: ${optionId}`);
    throw new ReturnRequestRejected('return_option_missing', '반품을 접수할 수 없습니다(반품 위치 없음)');
  }
  return { optionId, locationId };
}

const normalizeItems = (items: Array<{ itemId: string; quantity: number }>) =>
  items.map((i) => ({ itemId: i.itemId, quantity: i.quantity })).sort((a, b) => a.itemId.localeCompare(b.itemId));

/** 같은 요청인지 — 품목(정렬)·사유·CS 가 고른 부담 주체. 메모·기한 넘김 사유는 넣지 않는다(재시도 때 문구만 달라도 같은 요청이다). */
function hashReturnRequest(
  items: Array<{ itemId: string; quantity: number }>,
  reasonValue: string,
  operatorFeeBearer: 'customer' | 'seller' | undefined,
): string {
  const body = { items, reasonValue, operatorFeeBearer: operatorFeeBearer ?? null };
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

const toResult = (
  returnId: string,
  status: string,
  requestId: string,
  items: Array<{ itemId: string; quantity: number }>,
  record: ReturnRequestRecord,
): RequestOrderReturnResult => ({
  returnId,
  requestId,
  status,
  items,
  feeBearer: record.feeBearer,
  windowOverridden: record.windowOverride !== null,
});
