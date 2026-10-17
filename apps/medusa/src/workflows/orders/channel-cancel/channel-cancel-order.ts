import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, MedusaError, Modules, OrderChangeStatus, OrderStatus } from '@medusajs/framework/utils';
import { cancelOrderWorkflow } from '@medusajs/medusa/core-flows';

import { paymentRefundLockKey } from '../../../modules/almond-payment/refund-data';
import { readWalletRefundRefusal } from '../../../modules/almond-payment/wallet-refund-refusal';
import { describeError } from '../../../utils/describe-error';
import { toNumber } from '../partial-cancel/amount';
import { issuePaymentRefund } from '../settlement/issue-payment-refund';
import { orderCancelLockKey, orderPaymentIds } from '../settlement/order-payments';
import type { RefundMode } from '../settlement/refund-mode';
import { planPaymentWalletRefundBookings, reconcileOrderWalletRefunds } from '../settlement/wallet-refund-ledger';

/** 맞추기 + 환불 + 취소가 넉넉히 들어가게 잡는다 — 레디스 잠금은 timeout 이 곧 만료다 */
const ORDER_LOCK_TIMEOUT_SECONDS = 120;
/** 부분취소·환불 투영과 같은 값. 이 잠금 안에서는 refundPaymentWorkflow 한 번만 돈다 */
const PAYMENT_LOCK_TIMEOUT_SECONDS = 30;

export type ChannelCancelInput = { orderId: string; refundMode: RefundMode; actorId?: string };
export type ChannelCancelResult = { orderId: string; status: 'canceled'; refund: { mode: RefundMode; amount: number } };

const refundNote = (orderId: string) => `channel-cancel:${orderId}`;

/**
 * 채널 주문 전체취소 정산(#1016 36번 재설계 스펙 §6.1). 기본 /admin/orders/:id/cancel 은 환불 오류를 삼켜(core-flows refundPaymentsStep 의
 * .catch) 환불 없이 취소하고 유령 환불 거래를 남긴다 — 여기선 «장부 맞추기 → 남은 몫 환불 → 기본 취소» 순서로 한다.
 * 취소된 주문엔 환불할 수 없으므로(크레딧 라인 단계가 돈이 나간 «뒤» 던진다, §2.2) 환불이 먼저다.
 * 다시 부르면 남은 몫만 환불하고 취소를 이어 간다.
 */
export async function channelCancelOrder(container: MedusaContainer, input: ChannelCancelInput): Promise<ChannelCancelResult> {
  const locking = container.resolve(Modules.LOCKING);
  return locking.execute(orderCancelLockKey(input.orderId), () => run(container, input), {
    timeout: ORDER_LOCK_TIMEOUT_SECONDS,
  });
}

async function run(container: MedusaContainer, input: ChannelCancelInput): Promise<ChannelCancelResult> {
  try {
    await assertCancelable(container, input.orderId);
  } catch (error) {
    // 재시도라면 사전검사가 돈이 나간 «뒤»에 도는 셈이다 — 앞 시도가 환불하고 끊긴 사이 주문 변경·출고가 생기면 여기서 400 이 나고,
    // channel-adapter 는 그것을 «취소 불가»로 읽는다(환불만 되고 출고). 이 경로로 돈이 나갔으면 500 으로 바꿔 재시도시킨다.
    // 이미 취소됨(INVALID_DATA)은 예외 — 수렴한 끝이라 channel-adapter 가 그 문장을 성공으로 읽는다
    const notAllowed = MedusaError.isMedusaError(error) && error.type === MedusaError.Types.NOT_ALLOWED;
    if (!notAllowed) throw error;
    let moved: boolean;
    try {
      moved = await moneyMovedHere(container, input.orderId);
    } catch (checkError) {
      // 판정을 못 하면 400 으로 닫지 않는다 — 돈이 나갔을 수 있다. 일시 실패(500)로 재시도시킨다
      throw new Error(`채널 취소가 중단됐습니다 — 환불 여부를 확인하지 못했습니다, 다시 시도합니다(${input.orderId}): ${describeError(checkError)}`);
    }
    if (moved) {
      throw new Error(`채널 취소가 중단됐습니다 — 환불은 이미 나갔습니다, 다시 시도합니다(${input.orderId}): ${describeError(error)}`);
    }
    throw error;
  }
  try {
    // ① 빠진 wallet 환불(외부·응답 유실)을 먼저 장부에 — 그래야 ② 의 «캡처 − 환불»이 이미 나간 돈을 또 내지 않는다
    await reconcileOrderWalletRefunds(container, input.orderId);
    await refundRemaining(container, input);
    // ③ 환불할 몫이 0 이라 그 안의 환불 단계는 아무것도 하지 않는다. 크레딧 라인은 위 환불이 이미 붙였다(빈 필터 → 0, 2026-10-11 실측)
    await cancelOrderWorkflow(container).run({ input: { order_id: input.orderId, canceled_by: input.actorId } });
  } catch (error) {
    // 영구 거절 표지만 그대로 올린다(400 — 주문은 안 취소됐다). 결제분이 여럿이면 앞 몫은 이미 나갔을 수 있는데, 그 돈은 다음 정산
    // (재시도·수동)의 장부 맞추기가 장부에 넣고 남은 몫만 낸다. 그 밖은 500 으로 바꿔 재시도시킨다 — 표지 없는 400 은
    // channel-adapter 가 «취소 불가»로 닫는다. 재시도는 맞추기 뒤 남은 몫만 환불한다
    if (readWalletRefundRefusal(error)) throw error;
    throw new Error(`채널 취소가 중단됐습니다 — 다시 시도합니다(${input.orderId}): ${describeError(error)}`);
  }
  return { orderId: input.orderId, status: 'canceled', refund: { mode: input.refundMode, amount: await refundedHere(container, input.orderId) } };
}

async function assertCancelable(container: MedusaContainer, orderId: string): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order',
    fields: ['id', 'status', 'fulfillments.canceled_at'],
    filters: { id: orderId },
  });
  // query.graph 의 링크 필드는 타입이 넓다 — 경계에서 필요한 칸으로만 좁힌다.
  const order = data[0] as { status?: string; fulfillments?: Array<{ canceled_at?: unknown } | null> } | undefined;
  if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order id not found: ${orderId}`);
  // 문장은 코어 throwIfOrderIsCancelled·cancelValidateOrder 와 같게 둔다 — channel-adapter 가 «이미 취소됨»을 이 문장으로 판정한다
  if (order.status === OrderStatus.CANCELED) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Order with id ${orderId} has been canceled.`);
  }
  // 환불 워크플로의 크레딧 라인 단계가 주문 변경을 만든다 — 진행 중인 변경이 있으면 거기서 실패하는데, 그때는 돈이 이미 나갔다
  const activeChanges = await container.resolve(Modules.ORDER).listOrderChanges(
    { order_id: orderId, status: [OrderChangeStatus.PENDING, OrderChangeStatus.REQUESTED] },
    { select: ['id'] },
  );
  if (activeChanges.length > 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Order with id ${orderId} has an active order change — 진행 중인 주문 변경(수정·반품·교환)을 먼저 정리해야 합니다`,
    );
  }
  if ((order.fulfillments ?? []).some((f) => f !== null && !f.canceled_at)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, 'All fulfillments must be canceled before canceling an order');
  }
}

/**
 * 이 경로로 돈이 이미 나갔나 — 장부의 이 메모 환불, 또는 장부에 아직 없지만 맞추기가 이 메모로 넣을 wallet 환불(응답 유실·다중 결제분의
 * 앞부분, 아직 진행 중인 자동 PENDING 포함). 읽기만 한다(투영·표식 쓰기 없음, 잠금 없음). 시도 표식만으로는 판정하지 않는다 — 영구 거절도 표식을 남기므로
 * 표식만 보면 정당한 사전검사 400 이 영원히 500 으로 돈다.
 */
async function moneyMovedHere(container: MedusaContainer, orderId: string): Promise<boolean> {
  if ((await refundedHere(container, orderId)) > 0) return true;
  for (const paymentId of await orderPaymentIds(container, orderId)) {
    // 진행 중(자동 PENDING)인 것도 — PG 결과가 아직이라 돈이 나갔을 수 있다. 400 으로 닫지 않고 500 으로 기다린다(D8)
    const { bookings, inFlight } = await planPaymentWalletRefundBookings(container, paymentId);
    if ([...bookings, ...inFlight].some((b) => b.note === refundNote(orderId))) return true;
  }
  return false;
}

/** 이 경로(채널 취소)가 장부에 남긴 환불 합 — 메모로 가린다. 응답 유실분도 장부 맞추기가 같은 메모로 넣는다 */
async function refundedHere(container: MedusaContainer, orderId: string): Promise<number> {
  const paymentIds = await orderPaymentIds(container, orderId);
  if (paymentIds.length === 0) return 0;
  const payments = await container.resolve(Modules.PAYMENT).listPayments({ id: paymentIds }, { relations: ['refunds'] });
  return payments
    .flatMap((p) => p.refunds ?? [])
    .filter((r) => r.note === refundNote(orderId))
    .reduce((s, r) => s + toNumber(r.amount), 0);
}

/** 결제마다 «캡처 − 환불»을 돌려준다. 오류는 잡지 않는다 — run() 이 표지(400)와 그 밖(500)을 가른다 */
async function refundRemaining(container: MedusaContainer, input: ChannelCancelInput): Promise<void> {
  const paymentModule = container.resolve(Modules.PAYMENT);
  const locking = container.resolve(Modules.LOCKING);
  for (const paymentId of await orderPaymentIds(container, input.orderId)) {
    await locking.execute(
      paymentRefundLockKey(paymentId),
      async () => {
        const p = await paymentModule.retrievePayment(paymentId, { relations: ['captures', 'refunds'] });
        if (p.canceled_at) return;
        const captured = (p.captures ?? []).reduce((s, x) => s + toNumber(x.amount), 0);
        const refunded = (p.refunds ?? []).reduce((s, x) => s + toNumber(x.amount), 0);
        const amount = captured - refunded;
        if (!(amount > 0)) return;
        await issuePaymentRefund(container, {
          paymentId,
          amount,
          note: refundNote(input.orderId),
          mode: input.refundMode,
          kind: 'ITEM_CANCEL',
          actorId: input.actorId,
        });
      },
      { timeout: PAYMENT_LOCK_TIMEOUT_SECONDS },
    );
  }
}
