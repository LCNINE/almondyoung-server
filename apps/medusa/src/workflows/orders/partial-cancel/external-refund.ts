import { createHash } from 'crypto';
import { toNumber } from './amount';
import { PartialCancelRejected, type CancelRequestItem } from './plan-partial-cancel';

/** 환불 투영(payment-events)이 Medusa 밖 wallet 환불에 다는 메모 접두어 */
export const EXTERNAL_REFUND_NOTE_PREFIX = 'wallet:';

export type ExternalRefundReason = 'external_refund_unresolved' | 'external_refund_exceeds' | 'external_refund_absent';

/** «이미 환불한 금액»이 필요하거나 맞지 않는 거절(#1016 37번, 스펙 §4.2). 라우트가 사유·금액을 실어 400 으로 낸다. */
export class PartialCancelExternalRefundRejected extends PartialCancelRejected {
  constructor(
    readonly reason: ExternalRefundReason,
    readonly unresolvedAmount: number,
    message: string,
  ) {
    super(message);
    this.name = 'PartialCancelExternalRefundRejected';
  }
}

const won = new Intl.NumberFormat('ko-KR');

/**
 * 품목에 연결 안 된 외부 환불(U). 외부 환불은 투영될 때 «금액 조정»(크레딧 라인)으로만 남아 어느 품목 몫인지 모른다 —
 * 앞선 부분취소가 «이미 환불함»으로 가져간 몫만 뺀다. 10-07 이전 외부 환불은 투영되지 않아 여기 없다(스펙 §4.1).
 */
export function unresolvedExternalRefund(
  refunds: Array<{ amount: unknown; note?: string | null }>,
  records: Array<{ externalRefundApplied?: number }>,
): number {
  const external = refunds
    .filter((r) => typeof r.note === 'string' && r.note.startsWith(EXTERNAL_REFUND_NOTE_PREFIX))
    .reduce((s, r) => s + toNumber(r.amount), 0);
  const claimed = records.reduce((s, r) => s + (r.externalRefundApplied ?? 0), 0);
  return Math.max(0, external - claimed);
}

/** 주문 수정 «전»에 부른다 — 거절이 주문을 건드리지 않게. 자동 차감은 하지 않는다(보상·차액 환불까지 먹는다, ADR-0043). */
export function checkAlreadyRefunded(unresolved: number, alreadyRefunded: number | undefined): void {
  if (unresolved <= 0) {
    if (alreadyRefunded !== undefined && alreadyRefunded > 0) {
      throw new PartialCancelExternalRefundRejected(
        'external_refund_absent',
        0,
        `이 주문에는 품목에 연결할 외부 환불이 없습니다 — 이미 환불한 금액(${won.format(alreadyRefunded)}원)을 비우고 다시 요청하세요`,
      );
    }
    return;
  }
  if (alreadyRefunded === undefined) {
    throw new PartialCancelExternalRefundRejected(
      'external_refund_unresolved',
      unresolved,
      `품목에 연결 안 된 외부 환불 ${won.format(unresolved)}원이 있습니다 — 이번 취소 품목에 이미 돌려준 금액을 적어 다시 요청하세요(없으면 0)`,
    );
  }
  if (alreadyRefunded > unresolved) {
    throw new PartialCancelExternalRefundRejected(
      'external_refund_exceeds',
      unresolved,
      `이미 환불한 금액 ${won.format(alreadyRefunded)}원이 품목에 연결 안 된 외부 환불 ${won.format(unresolved)}원보다 많습니다`,
    );
  }
}

/** 상계는 품목 차액까지만 — 넘기면 음수 크레딧 라인이 차액을 넘어 장부가 뒤집힌다. 남는 몫은 U 에 남아 다음 취소가 다시 묻는다. */
export function appliedExternalRefund(alreadyRefunded: number | undefined, owed: number): number {
  return Math.min(alreadyRefunded ?? 0, Math.max(0, owed));
}

const normalize = (items: CancelRequestItem[]) =>
  [...items].map((i) => ({ itemId: i.itemId, quantity: i.quantity })).sort((a, b) => a.itemId.localeCompare(b.itemId));

/** 금액이 없으면 옛 해시(품목만)와 같아야 한다 — 배포 중 옛 코드가 남긴 edited 기록을 «다른 요청»으로 거절하지 않게. */
export function hashRequest(items: CancelRequestItem[], alreadyRefunded: number | undefined): string {
  const body = alreadyRefunded === undefined ? normalize(items) : { items: normalize(items), alreadyRefunded };
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}
