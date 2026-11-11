// core 는 이 영어 문구를 접두어로 판정에 쓰므로 바꾸지 않고, 보드에서만 한글로 옮긴다
const REASONS: [prefix: string, korean: string][] = [
  [
    'order sent but response lost',
    '와우프레스에 주문을 보냈지만 응답을 못 받았습니다. 5분 뒤 주문 키로 와우프레스에 주문이 들어갔는지 조회합니다.',
  ],
  [
    'order sent but not confirmed',
    '와우프레스에 주문을 보냈지만 들어갔는지 확인하지 못했습니다. 와우프레스에서 주문을 확인한 뒤 재전송해 주세요.',
  ],
  [
    'order sent, ordnum ',
    '와우프레스 주문번호를 받았지만 저장하지 못했습니다. 와우프레스에서 주문을 확인해 주세요.',
  ],
  [
    'duplicate wowpress order suspected',
    '와우프레스에 같은 주문이 두 번 들어갔을 수 있습니다. 와우프레스에서 확인해 주세요.',
  ],
  [
    'order placed after cancel',
    '취소한 뒤에 와우프레스 주문이 들어왔습니다. 와우프레스에서 확인해 주세요.',
  ],
  [
    'almond design does not belong to the ordering customer',
    '주문한 고객의 시안이 아니라서 발주하지 않았습니다.',
  ],
  [
    'almond design does not match the purchased print product or size',
    '시안이 구매한 인쇄 상품이나 크기와 달라서 발주하지 않았습니다.',
  ],
  [
    'no wowpress spec for variant',
    '와우프레스 품목 매핑이 없는 옵션이라 발주하지 않았습니다.',
  ],
  [
    'channel decreased quantity before the print was ordered',
    '발주 전에 주문 수량이 줄었습니다. 수량을 확인한 뒤 진행해 주세요.',
  ],
  [
    'sales order cancelled after print shipped',
    '인쇄물이 출고된 뒤 주문이 취소됐습니다. 반품·환불을 확인해 주세요.',
  ],
  [
    'print order cancelled but sales cancel failed',
    '와우프레스 발주는 취소했지만 판매 주문 취소에 실패했습니다.',
  ],
  [
    'wowpress cancelled but sales cancel failed',
    '와우프레스 주문은 취소했지만 판매 주문 취소에 실패했습니다.',
  ],
  [
    'cancelled on channel while submitting',
    '발주하는 사이에 주문이 취소됐습니다.',
  ],
];

const REJECTED = 'wowpress rejected the order: ';

// 여러 기록이 ' | ' 로 이어 붙을 수 있다. 모르는 문구는 원문 그대로 둔다
export function describeLastError(raw: string): string[] {
  return raw.split(' | ').map((part) => {
    if (part.startsWith(REJECTED))
      return `와우프레스가 주문을 받지 않았습니다. 사유: ${part.slice(REJECTED.length)}`;
    const found = REASONS.find(([prefix]) => part.startsWith(prefix));

    return found ? found[1] : part;
  });
}
