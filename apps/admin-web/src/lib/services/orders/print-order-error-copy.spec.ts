import {
  PRINT_ORDER_ERROR_COPY,
  printOrderServerMessageCopy,
} from './print-order-error-copy';

const SERVER: [string, string][] = [
  [
    'This print order has a duplicate or unsaved WowPress order record; resolve it on WowPress',
    '와우프레스에 주문이 남아 있을 수 있어',
  ],
  [
    'An order may already exist on WowPress. Verify on WowPress that there is no order, then retry with confirmNoWowpressOrder',
    '와우프레스에서 주문이 없는 것을 확인한 뒤',
  ],
  [
    'Print order changed while retrying; reload and try again',
    '그 사이 다른 곳에서 상태가 바뀌었습니다',
  ],
  [
    'Print order changed while resolving; reload and try again',
    '그 사이 다른 곳에서 상태가 바뀌었습니다',
  ],
  [
    'A WowPress order may still be in flight for this print order; try again later',
    '아직 진행 중일 수 있습니다',
  ],
  [
    'This print order is already cancelled; it cannot go back to production',
    '생산 진행으로 되돌릴 수 없습니다',
  ],
  [
    'Only failed or unsupported print orders can be retried (current: submitted)',
    '발주 실패 또는 미지원 품목만',
  ],
  [
    'Only refused or stuck cancellations can be resolved (current: submitted)',
    '취소 확인이 필요한 건만',
  ],
];

describe('printOrderServerMessageCopy', () => {
  it.each(SERVER)('%s', (message, expected) => {
    expect(printOrderServerMessageCopy(message)).toContain(expected);
  });

  it('표의 모든 항목을 위 서버 문구가 덮는다', () => {
    expect(SERVER).toHaveLength(PRINT_ORDER_ERROR_COPY.length);
  });

  it('모르는 메시지는 그대로 돌려준다', () => {
    expect(printOrderServerMessageCopy('Refund failed: x')).toBe(
      'Refund failed: x'
    );
  });
});
