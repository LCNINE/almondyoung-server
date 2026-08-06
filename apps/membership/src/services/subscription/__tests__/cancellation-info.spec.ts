import { resolveCancellationInfo, CancellationInfoInput } from '../cancellation-info';

/**
 * 종료 경로가 여섯 가지이고 각각 남기는 흔적이 다르다. 화면이 이걸 추론하면 실제로 어긋났다 —
 * 시스템이 계좌 심사 거절로 끊은 계약이 '고객이 즉시 해지함' 으로 보였다.
 */
describe('resolveCancellationInfo', () => {
  const base = (over: Partial<CancellationInfoInput['contract']> = {}): CancellationInfoInput['contract'] => ({
    status: 'ACTIVE',
    cancelledAt: null,
    recurringCancelledAt: null,
    cancellationReasonCode: null,
    recurringCancellationReasonCode: null,
    isVoided: false,
    reason: null,
    ...over,
  });

  const call = (contract: CancellationInfoInput['contract'], events: CancellationInfoInput['events'] = []) =>
    resolveCancellationInfo({ contract, events, endsAt: '2026-09-03' });

  it('해지한 적이 없는 계약은 해지 내역이 아니다', () => {
    expect(call(base())).toBeNull();
  });

  it('고객 즉시해지', () => {
    const info = call(
      base({ status: 'CANCELLED', cancelledAt: new Date('2026-08-04T00:00:00Z'), cancellationReasonCode: 'NOT_USING' }),
      [{ eventType: 'CANCELLED', causedBy: 'USER', metadata: { cancellationType: 'IMMEDIATE' } }],
    );
    expect(info?.origin).toBe('CUSTOMER_IMMEDIATE');
    expect(info?.state).toBe('ENDED');
    expect(info?.endedAt).not.toBeNull();
  });

  it('관리자 강제취소는 고객 해지와 구분된다', () => {
    const info = call(
      base({ status: 'CANCELLED', cancelledAt: new Date(), cancellationReasonCode: 'ADMIN_FORCED' }),
      [{ eventType: 'CANCELLED', causedBy: 'ADMIN', metadata: { isForced: true, reason: '품절 보상' } }],
    );
    expect(info?.origin).toBe('ADMIN_FORCED');
    expect(info?.reasonLabel).toBe('품절 보상');
  });

  it('해지 예약은 잔여기간 이용 중과 종료를 상태로 구분한다', () => {
    const scheduled = base({ recurringCancelledAt: new Date(), recurringCancellationReasonCode: 'EXPENSIVE' });
    const active = call(scheduled, [{ eventType: 'RECURRING_CANCELLED', causedBy: 'USER', metadata: {} }]);
    expect(active?.origin).toBe('CUSTOMER_SCHEDULED');
    expect(active?.state).toBe('SCHEDULED_ACTIVE');
    expect(active?.stateLabel).toBe('이용 중');

    const ended = call({ ...scheduled, status: 'EXPIRED' }, [
      { eventType: 'RECURRING_CANCELLED', causedBy: 'USER', metadata: {} },
    ]);
    expect(ended?.origin).toBe('CUSTOMER_SCHEDULED');
    expect(ended?.state).toBe('ENDED');
  });

  it('관리자 대행 해지예약은 주체가 드러난다', () => {
    const info = call(base({ recurringCancelledAt: new Date(), recurringCancellationReasonCode: 'ADMIN_REQUESTED' }), [
      { eventType: 'RECURRING_CANCELLED', causedBy: 'ADMIN', metadata: { reasonText: '고객 전화 요청' } },
    ]);
    expect(info?.origin).toBe('ADMIN_SCHEDULED');
    expect(info?.reasonLabel).toBe('고객 전화 요청');
  });

  // 라이브에서 실제로 이 건이 '고객 즉시해지' 로 보였다.
  it('계좌 심사 거절로 시스템이 끊은 건은 고객 해지가 아니다', () => {
    const info = call(base({ status: 'CANCELLED', cancelledAt: new Date() }), [
      { eventType: 'TERMINATED', causedBy: 'SYSTEM', metadata: { reason: 'MANDATE_REJECTED:Q201' } },
    ]);
    expect(info?.origin).toBe('MANDATE_REJECTED');
    expect(info?.originLabel).toBe('계좌 심사 거절로 종료');
    expect(info?.reasonLabel).toBe('계좌 자동이체 심사 거절');
    expect(info?.reasonDetail).toBe('Q201');
    // 고객이 다음에 무엇을 하면 되는지까지 알려줘야 문의로 이어지지 않는다.
    expect(info?.customerNotice).toContain('다른 계좌로 다시 등록');
  });

  it('미수로 종료된 건은 결제 실패로 분류된다', () => {
    const info = call(base({ status: 'CANCELLED', cancelledAt: new Date() }), [
      { eventType: 'TERMINATED', causedBy: 'SYSTEM', metadata: { reason: 'UNCOLLECTIBLE:CMS_FAIL' } },
    ]);
    expect(info?.origin).toBe('PAYMENT_FAILED');
    expect(info?.reasonLabel).toBe('결제 실패(재시도 소진)');
    // 출금 실패 종료는 계좌를 지우지 않는다(해지 기본이 '계좌 유지'). 재등록을 안내하면 고객이
    // 멀쩡한 계좌를 지우고 며칠짜리 CMS 재심사를 다시 겪는다 — 필요한 건 재가입뿐이다.
    expect(info?.customerNotice).toContain('다시 가입');
    expect(info?.customerNotice).toContain('계좌를 새로 등록하실 필요는 없습니다');
    expect(info?.customerNotice).not.toContain('결제수단을 다시 등록');
  });

  // 결제관리에서 환불하면 계약 이벤트 없이 isVoided 로만 남는다.
  it('환불로 회수된 건은 이벤트가 없어도 경로가 드러난다', () => {
    const info = call(base({ status: 'CANCELLED', cancelledAt: new Date(), isVoided: true, reason: '결제 환불' }));
    expect(info?.origin).toBe('REFUND_VOIDED');
    expect(info?.reasonLabel).toBe('결제 환불');
  });

  it('해지 없이 기간만 끝난 계약은 기간 만료로 표시된다', () => {
    const info = call(base({ status: 'EXPIRED' }));
    expect(info?.origin).toBe('NATURAL_EXPIRY');
  });

  it('사유 코드는 마스터 표시 문구로 해석된다', () => {
    const info = resolveCancellationInfo({
      contract: base({ status: 'CANCELLED', cancelledAt: new Date(), cancellationReasonCode: 'NOT_USING' }),
      events: [{ eventType: 'CANCELLED', causedBy: 'USER', metadata: {} }],
      endsAt: null,
      reasonTextByCode: new Map([['NOT_USING', '이용하지 않아요']]),
    });
    expect(info?.reasonLabel).toBe('이용하지 않아요');
  });
});
