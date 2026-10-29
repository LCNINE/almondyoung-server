import type {
  CustomerReturnAttention,
  CustomerReturnKind,
  CustomerReturnPickupStatus,
  CustomerReturnReason,
  CustomerReturnStatus,
} from '@/lib/types/dto/customer-returns';
import {
  EXCHANGE_STATUS_LABELS,
  RETURN_ACTION_LABELS,
  RETURN_ATTENTION_LABELS,
  RETURN_KIND_LABELS,
  RETURN_FEE_BEARER_LABELS,
  RETURN_PICKUP_STATUS_LABELS,
  RETURN_REASON_LABELS,
  RETURN_REASON_OPTIONS,
  RETURN_STATUS_LABELS,
  statusLabel,
} from './customer-return-labels';

// CI 는 admin-web tsc 를 안 돈다 — 이 단언이 유니온과 맵의 드리프트를 막는 유일한 방어선이다.
const STATUSES: CustomerReturnStatus[] = [
  'expected',
  'arrived',
  'inspected',
  'held',
  'refund_pending',
  'settled',
  'cancelled',
];
const REASONS: CustomerReturnReason[] = [
  'change_of_mind',
  'defective',
  'not_as_described',
  'wrong_item',
  'damaged_in_shipping',
  'other',
];
const ATTENTIONS: CustomerReturnAttention[] = [
  'held',
  'settlement_failed',
  'prepayment_failed',
  'partial_arrival',
  'refund_overdue',
  'pickup_failed',
  'exchange_overdue',
];
const KINDS: CustomerReturnKind[] = ['return', 'exchange'];
const PICKUP_STATUSES: CustomerReturnPickupStatus[] = [
  'pending',
  'reserved',
  'failed',
  'void',
  'cancel_pending',
  'cancelled',
];

const keys = (o: object) => Object.keys(o).sort();

describe('customer-return-labels', () => {
  it('상태 라벨 키가 유니온 전체와 같다', () => {
    expect(keys(RETURN_STATUS_LABELS)).toEqual([...STATUSES].sort());
  });
  it('사유 라벨 키가 유니온 전체와 같다', () => {
    expect(keys(RETURN_REASON_LABELS)).toEqual([...REASONS].sort());
  });
  it('부담 주체 라벨 키가 customer·seller 다', () => {
    expect(keys(RETURN_FEE_BEARER_LABELS)).toEqual(['customer', 'seller']);
  });
  it('확인 필요 라벨 키가 유니온 전체와 같다', () => {
    expect(keys(RETURN_ATTENTION_LABELS)).toEqual([...ATTENTIONS].sort());
  });
  it('회수 상태 라벨 키가 유니온 전체와 같고 비어 있지 않다', () => {
    expect(keys(RETURN_PICKUP_STATUS_LABELS)).toEqual([...PICKUP_STATUSES].sort());
    for (const s of PICKUP_STATUSES) expect(RETURN_PICKUP_STATUS_LABELS[s]).not.toBe('');
    expect(RETURN_PICKUP_STATUS_LABELS.failed).toBe('접수 실패');
    expect(RETURN_ATTENTION_LABELS.pickup_failed).toBe('회수 미접수');
  });
  it('문구가 정해진 값이다', () => {
    expect(RETURN_STATUS_LABELS.refund_pending).toBe('환불 실패');
    expect(RETURN_ATTENTION_LABELS.refund_overdue).toBe('환불 기한 지남');
    expect(RETURN_FEE_BEARER_LABELS.seller).toBe('판매자');
  });
  it('종류 라벨 키가 유니온 전체와 같다', () => {
    expect(keys(RETURN_KIND_LABELS)).toEqual([...KINDS].sort());
    expect(RETURN_KIND_LABELS).toEqual({ return: '반품', exchange: '교환' });
  });
  it('교환 상태 라벨 — 종류 칸이 따로 있어 «교환»을 붙이지 않는다', () => {
    expect(keys(EXCHANGE_STATUS_LABELS)).toEqual([...STATUSES].sort());
    expect(EXCHANGE_STATUS_LABELS).toEqual({
      expected: '도착 대기',
      arrived: '도착',
      inspected: '정산 중',
      held: '보류',
      refund_pending: '정산 실패',
      settled: '완료',
      cancelled: '취소',
    });
  });
  it('statusLabel 은 종류별 표를 고른다', () => {
    expect(statusLabel('exchange', 'settled')).toBe('완료');
    expect(statusLabel('exchange', 'refund_pending')).toBe('정산 실패');
    expect(statusLabel('return', 'settled')).toBe('환불 완료');
    for (const s of STATUSES) expect(statusLabel('return', s)).toBe(RETURN_STATUS_LABELS[s]);
  });
  it('교환 문구', () => {
    expect(RETURN_ATTENTION_LABELS.exchange_overdue).toBe('교환 기한 지남');
    expect(RETURN_ACTION_LABELS.releaseExchange).toBe('교환품 보내기');
  });
  it('사유 선택지는 Medusa 표 순서 그대로 여섯 개이고 other 가 마지막이다', () => {
    expect(RETURN_REASON_OPTIONS.map((o) => o.value)).toEqual(REASONS);
    expect(RETURN_REASON_OPTIONS.map((o) => o.label)).toEqual([
      '단순 변심',
      '상품 하자',
      '상품 설명과 다름',
      '오배송',
      '배송 중 파손',
      '기타',
    ]);
  });
});
