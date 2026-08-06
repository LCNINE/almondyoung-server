/**
 * 계약이 어떻게 끝났는지를 하나의 사실로 정리한다.
 *
 * 종료 경로가 여섯 가지인데 각각 남기는 흔적이 다르다 — 고객 해지는 사유 코드, 관리자 해지는 감사
 * 주체, 시스템 종료는 `TERMINATED` 이벤트, 환불 회수는 `isVoided`+`reason` 컬럼. 화면마다 이걸 추론하면
 * 반드시 어긋난다(실제로 시스템이 끊은 건이 '고객이 즉시 해지함' 으로 보였다). 서버가 한 번 계산해
 * 내려주고 고객·관리자 화면이 같은 값을 쓴다.
 *
 * **경로(누가 왜 끝냈나)와 상태(지금 어떤가)는 다른 축이다.** 즉시해지도 '해지 완료' 이므로 둘을 한
 * 컬럼에 섞으면 라벨이 논리적으로 겹친다.
 */

/** 무엇이 이 계약을 끝냈나 */
export type CancellationOrigin =
  | 'CUSTOMER_IMMEDIATE'
  | 'CUSTOMER_SCHEDULED'
  | 'ADMIN_FORCED'
  | 'ADMIN_SCHEDULED'
  | 'PAYMENT_FAILED'
  | 'MANDATE_REJECTED'
  | 'REFUND_VOIDED'
  | 'NATURAL_EXPIRY';

/** 지금 어떤 상태인가 — 잔여기간을 쓰고 있는지, 끝났는지 */
export type CancellationState = 'SCHEDULED_ACTIVE' | 'ENDED';

export interface CancellationInfo {
  origin: CancellationOrigin;
  originLabel: string;
  state: CancellationState;
  stateLabel: string;
  /** 해지를 신청한 시각(예약이면 신청 시각, 즉시면 해지 시각) */
  requestedAt: string | null;
  /** 실제로 이용이 끝난 시각. 잔여기간 이용 중이면 null */
  endedAt: string | null;
  /** 이용 종료(예정)일 */
  endsAt: string | null;
  /** 사유 한 줄 — 고객 선택 사유·관리자 입력 사유·시스템 사유를 같은 자리에 담는다 */
  reasonLabel: string | null;
  /** 원인 코드 등 부가 설명(효성 응답코드 등). 없으면 null */
  reasonDetail: string | null;
  /** 고객에게 그대로 보여줄 수 있는 안내와 다음 행동 */
  customerNotice: string | null;
}

const ORIGIN_LABEL: Record<CancellationOrigin, string> = {
  CUSTOMER_IMMEDIATE: '고객 즉시해지',
  CUSTOMER_SCHEDULED: '고객 해지예약',
  ADMIN_FORCED: '관리자 강제취소',
  ADMIN_SCHEDULED: '관리자 해지예약',
  PAYMENT_FAILED: '결제 실패로 종료',
  MANDATE_REJECTED: '계좌 심사 거절로 종료',
  REFUND_VOIDED: '환불로 자격 회수',
  NATURAL_EXPIRY: '기간 만료',
};

/**
 * 고객에게 그대로 보여줄 안내. **왜 끝났는지와 다음에 무엇을 하면 되는지**를 함께 적는다 —
 * 이유만 알려주고 방법을 안 알려주면 문의로 이어진다.
 */
const CUSTOMER_NOTICE: Partial<Record<CancellationOrigin, string>> = {
  MANDATE_REJECTED:
    '등록하신 계좌의 자동이체 심사가 거절되어 멤버십이 종료되었습니다. 다른 계좌로 다시 등록하시면 이어서 이용하실 수 있어요.',
  // 재출금을 되살릴 방법이 없다는 사실을 정확히 적는다. 계좌는 지워지지 않으므로(해지 시 기본이
  // '계좌 유지') 재등록·재심사는 필요 없고, 필요한 것은 **재가입**이다. "결제수단을 다시 등록하세요"
  // 라고 안내하면 고객이 멀쩡한 계좌를 지우고 며칠짜리 CMS 심사를 다시 겪는다.
  PAYMENT_FAILED:
    '출금이 여러 번 실패해 멤버십이 종료되었습니다. 계좌에 금액을 채우신 뒤 다시 가입하시면 ' +
    '등록해 두신 계좌로 이어서 이용하실 수 있어요(계좌를 새로 등록하실 필요는 없습니다).',
  REFUND_VOIDED: '결제가 환불되어 멤버십이 종료되었습니다.',
};

/** 시스템 종료 사유 코드(`MANDATE_REJECTED:Q201` 형태)를 사람이 읽는 값으로 나눈다. */
function parseSystemReason(raw: string | null): { origin: CancellationOrigin; label: string; detail: string | null } {
  if (!raw) return { origin: 'PAYMENT_FAILED', label: '결제 실패', detail: null };

  const [head, ...rest] = raw.split(':');
  const detail = rest.join(':').trim() || null;

  if (head === 'MANDATE_REJECTED') {
    return { origin: 'MANDATE_REJECTED', label: '계좌 자동이체 심사 거절', detail };
  }
  if (head === 'UNCOLLECTIBLE') {
    return { origin: 'PAYMENT_FAILED', label: '결제 실패(재시도 소진)', detail };
  }
  if (head === 'INVOICE_VOIDED') {
    return { origin: 'PAYMENT_FAILED', label: '청구 취소로 자격 회수', detail };
  }
  if (head === 'BILLING_CANCEL_MAX_ATTEMPTS') {
    return { origin: 'PAYMENT_FAILED', label: '결제 취소 반복으로 종료', detail };
  }
  return { origin: 'PAYMENT_FAILED', label: raw, detail: null };
}

export interface CancellationInfoInput {
  contract: {
    status: string;
    cancelledAt: Date | null;
    recurringCancelledAt: Date | null;
    cancellationReasonCode: string | null;
    recurringCancellationReasonCode: string | null;
    isVoided: boolean | null;
    /** voidSubscription 이 남기는 사유(환불 회수·가입 실패 보상) */
    reason: string | null;
  };
  /** 이 계약의 종료 관련 이벤트(최신 우선 정렬 불필요 — 종류별로 찾는다) */
  events: { eventType: string; causedBy: string; metadata: Record<string, unknown> }[];
  /** 자격 종료(예정)일 */
  endsAt: string | null;
  /** 사유 코드 → 표시 문구(cancellation_reasons 마스터) */
  reasonTextByCode?: Map<string, string>;
}

/**
 * 계약 하나의 종료 사실을 계산한다. DB·HTTP 를 모르는 순수 함수 — 목록과 상세가 같은 값을 쓴다.
 * 해지된 적이 없으면 null 을 돌려준다(해지 내역이 아니다).
 */
export function resolveCancellationInfo(input: CancellationInfoInput): CancellationInfo | null {
  const { contract, events, endsAt } = input;
  const scheduled = contract.recurringCancelledAt !== null;
  const ended = contract.status === 'CANCELLED' || contract.status === 'EXPIRED';
  if (!scheduled && !ended) return null;

  const terminated = events.find((e) => e.eventType === 'TERMINATED');
  const cancelledEvent = events.find((e) => e.eventType === 'CANCELLED');
  const recurringEvent = events.find((e) => e.eventType === 'RECURRING_CANCELLED');

  const state: CancellationState = scheduled && contract.status === 'ACTIVE' ? 'SCHEDULED_ACTIVE' : 'ENDED';
  const requestedAt = (contract.recurringCancelledAt ?? contract.cancelledAt)?.toISOString() ?? null;
  const endedAt = state === 'ENDED' ? (contract.cancelledAt?.toISOString() ?? null) : null;

  const resolveReasonText = (code: string | null | undefined): string | null => {
    if (!code) return null;
    return input.reasonTextByCode?.get(code) ?? code;
  };

  const base = { state, stateLabel: state === 'SCHEDULED_ACTIVE' ? '이용 중' : '이용 종료', requestedAt, endedAt, endsAt };

  // 1) 시스템 종료 — 결제 실패·계좌 심사 거절. 고객이 해지한 것이 아니다.
  if (terminated) {
    const parsed = parseSystemReason((terminated.metadata as { reason?: string }).reason ?? null);
    return {
      ...base,
      origin: parsed.origin,
      originLabel: ORIGIN_LABEL[parsed.origin],
      reasonLabel: parsed.label,
      reasonDetail: parsed.detail,
      customerNotice: CUSTOMER_NOTICE[parsed.origin] ?? null,
    };
  }

  // 2) 환불로 자격 회수 / 가입 실패 보상 — 계약 이벤트 없이 isVoided 로만 남는다.
  if (contract.isVoided) {
    return {
      ...base,
      origin: 'REFUND_VOIDED',
      originLabel: ORIGIN_LABEL.REFUND_VOIDED,
      reasonLabel: contract.reason ?? '환불로 자격 회수',
      reasonDetail: null,
      customerNotice: CUSTOMER_NOTICE.REFUND_VOIDED ?? null,
    };
  }

  // 3) 해지 예약 — 주체는 이벤트의 causedBy 가 사실이다(관리자 대행과 고객 셀프를 구분).
  if (scheduled) {
    const byAdmin = recurringEvent?.causedBy === 'ADMIN';
    const origin: CancellationOrigin = byAdmin ? 'ADMIN_SCHEDULED' : 'CUSTOMER_SCHEDULED';
    const reasonText =
      (recurringEvent?.metadata as { reasonText?: string } | undefined)?.reasonText ??
      resolveReasonText(contract.recurringCancellationReasonCode);
    return {
      ...base,
      origin,
      originLabel: ORIGIN_LABEL[origin],
      reasonLabel: reasonText,
      reasonDetail: null,
      customerNotice: null,
    };
  }

  // 4) 즉시 해지 — 관리자 강제취소와 고객 셀프를 구분한다.
  const forced =
    contract.cancellationReasonCode === 'ADMIN_FORCED' ||
    (cancelledEvent?.metadata as { isForced?: boolean } | undefined)?.isForced === true ||
    cancelledEvent?.causedBy === 'ADMIN';
  if (contract.status === 'CANCELLED') {
    const origin: CancellationOrigin = forced ? 'ADMIN_FORCED' : 'CUSTOMER_IMMEDIATE';
    const adminReason = (cancelledEvent?.metadata as { reason?: string } | undefined)?.reason;
    return {
      ...base,
      origin,
      originLabel: ORIGIN_LABEL[origin],
      reasonLabel: forced ? (adminReason ?? '관리자 처리') : resolveReasonText(contract.cancellationReasonCode),
      reasonDetail: null,
      customerNotice: null,
    };
  }

  // 5) 해지 기록 없이 기간이 끝난 계약(1회 결제 종료 등) — 해지 내역이 아니다.
  return {
    ...base,
    origin: 'NATURAL_EXPIRY',
    originLabel: ORIGIN_LABEL.NATURAL_EXPIRY,
    reasonLabel: null,
    reasonDetail: null,
    customerNotice: null,
  };
}
