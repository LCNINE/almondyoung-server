import { Charge } from '../types';

/**
 * 지연 승인(deferred approval) — PG 승인(=실제 출금)을 주문 생성 이후로 미루는 모드.
 *
 * 카드/토스는 결제창 완료가 아니라 **서버의 승인 API 호출** 시점에 돈이 빠진다. 기본 흐름은
 * wallet-web 이 결제창 리다이렉트 직후 승인까지 끝내므로, 그 뒤 Medusa 가 주문을 만들다
 * 재고부족으로 실패하면 "돈은 빠졌는데 주문은 없는" 고아결제가 된다.
 *
 * 지연 승인 모드에서는 결제창 완료 시 승인 파라미터만 charge 에 적재(stage)해 두고,
 * Medusa 의 completeCartWorkflow 가 주문 생성 + 재고예약을 모두 성공시킨 뒤 마지막 단계
 * (authorizePaymentSession → almond-payment.authorizePayment)에서 wallet 의
 * finalize-approval 을 부를 때 비로소 승인 API 를 호출한다. 재고부족으로 워크플로가 실패하면
 * 승인 자체에 도달하지 못하므로 고객 돈은 움직이지 않는다.
 *
 * 적재된 승인은 결제창 완료 후 짧은 시간 안에 확정돼야 한다(PG 승인 유효시간). 확정되지 않은
 * 채로 actionExpiresAt 이 지나면 TossActionExpirationJob 이 charge 를 CANCELED 로 회수하고,
 * PG 쪽 미승인 결제는 자동 만료된다 — 역시 돈이 빠지지 않는 안전한 방향이다.
 */
export const DEFERRED_APPROVAL_METADATA_KEY = 'approvalMode';
export const DEFERRED_APPROVAL_METADATA_VALUE = 'DEFERRED';

export interface StagedApproval {
  provider: 'TOSS';
  /** PG 승인 토큰 (Toss paymentKey) */
  providerToken: string;
  /** PG 주문번호 (chargeId 에서 대시 제거한 값) */
  orderId: string;
  amount: number;
  stagedAt: string;
}

/** intent.metadata 가 지연 승인 모드를 요구하는지 판정한다. */
export function isDeferredApprovalIntent(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.[DEFERRED_APPROVAL_METADATA_KEY] === DEFERRED_APPROVAL_METADATA_VALUE;
}

/** charge.responsePayload 에 적재된 승인 파라미터를 읽는다. 없거나 형식이 깨졌으면 null. */
export function readStagedApproval(charge: Charge): StagedApproval | null {
  const raw = (charge.responsePayload as Record<string, unknown> | null | undefined)?.stagedApproval;
  if (!raw || typeof raw !== 'object') return null;

  const staged = raw as Partial<StagedApproval>;
  if (staged.provider !== 'TOSS') return null;
  if (typeof staged.providerToken !== 'string' || staged.providerToken.length === 0) return null;
  if (typeof staged.orderId !== 'string' || staged.orderId.length === 0) return null;
  if (typeof staged.amount !== 'number') return null;

  return {
    provider: staged.provider,
    providerToken: staged.providerToken,
    orderId: staged.orderId,
    amount: staged.amount,
    stagedAt: typeof staged.stagedAt === 'string' ? staged.stagedAt : new Date(0).toISOString(),
  };
}
