import {
  pendingRefundToast,
  pendingTransfersOf,
  refundExecutionLabel,
  refundFailureLabel,
  refundListHref,
} from './refund-execution';

describe('refundExecutionLabel', () => {
  it('수동 실행은 «계좌 송금», 자동·모름은 빈 칸(정상 상태는 숨긴다)', () => {
    expect(refundExecutionLabel('MANUAL')).toBe('계좌 송금');
    expect(refundExecutionLabel('AUTO')).toBe('');
    expect(refundExecutionLabel(undefined)).toBe('');
  });
});

describe('pendingRefundToast — 결제 상세 사이드바의 PENDING 환불 안내', () => {
  it('무통장은 송금 뒤 «환불 내역»에서 [완료 처리] — 그 버튼이 이제 있다(PR 6)', () => {
    expect(pendingRefundToast(true)).toBe('환불 대기 중: 무통장 입금 환불은 수동 송금이 필요합니다. 송금 뒤 환불 내역에서 [완료 처리]를 눌러 주세요.');
  });
  it('카드 등은 PG 처리 중 — 사람이 닫을 행이 아니다', () => {
    expect(pendingRefundToast(false)).toBe('환불 접수됨: PG 처리 결과를 기다리고 있습니다.');
  });
});

describe('refundFailureLabel — «환불 내역» 실패 사유', () => {
  it('FAILED 만 보인다 — 정상 상태는 숨긴다', () => {
    expect(refundFailureLabel({ status: 'SUCCEEDED', failureCode: null, retryable: null })).toBe('');
    expect(refundFailureLabel({ status: 'PENDING', failureCode: 'X', retryable: false })).toBe('');
  });
  it('영구 거절은 «다시 시도 불가», 일시·분류 전은 코드만', () => {
    expect(refundFailureLabel({ status: 'FAILED', failureCode: 'REFUND_REJECTED', retryable: false })).toBe('REFUND_REJECTED · 다시 시도 불가');
    expect(refundFailureLabel({ status: 'FAILED', failureCode: 'PROVIDER_ERROR', retryable: true })).toBe('PROVIDER_ERROR');
    expect(refundFailureLabel({ status: 'FAILED', failureCode: null, retryable: null })).toBe('');
  });
});

describe('송금 대기 환불', () => {
  const row = (id: string, over: Partial<{ status: string; manualConfirmable: boolean; createdAt: string }> = {}) => ({
    id,
    status: 'PENDING',
    manualConfirmable: true,
    createdAt: '2026-11-02T00:00:00.000Z',
    ...over,
  });

  it('사람이 닫을 대기 환불만, 오래된 것부터', () => {
    const rows = [
      row('new', { createdAt: '2026-11-03T00:00:00.000Z' }),
      row('card-pending', { manualConfirmable: false }),
      row('done', { status: 'SUCCEEDED' }),
      row('old', { createdAt: '2026-11-01T00:00:00.000Z' }),
    ];
    expect(pendingTransfersOf(rows).map((r) => r.id)).toEqual(['old', 'new']);
    expect(rows.map((r) => r.id)).toEqual(['new', 'card-pending', 'done', 'old']);
  });

  it('한 결제로 거른 환불 내역 주소', () => {
    expect(refundListHref('a b')).toBe('/payments/refunds?intentId=a%20b');
  });
});
