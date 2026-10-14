type Entry = { exact?: string; prefix?: string; copy: string };

export const PRINT_ORDER_ERROR_COPY: Entry[] = [
  {
    exact:
      'This print order has a duplicate or unsaved WowPress order record; resolve it on WowPress',
    copy: '와우프레스에 주문이 남아 있을 수 있어 처리할 수 없습니다. 와우프레스에서 먼저 확인해 주세요.',
  },
  {
    prefix: 'An order may already exist on WowPress.',
    copy: '와우프레스에 주문이 남아 있을 수 있습니다. 와우프레스에서 주문이 없는 것을 확인한 뒤 다시 시도해 주세요.',
  },
  {
    exact: 'Print order changed while retrying; reload and try again',
    copy: '그 사이 다른 곳에서 상태가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.',
  },
  {
    exact: 'Print order changed while resolving; reload and try again',
    copy: '그 사이 다른 곳에서 상태가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.',
  },
  {
    exact:
      'A WowPress order may still be in flight for this print order; try again later',
    copy: '와우프레스 발주가 아직 진행 중일 수 있습니다. 잠시 뒤 다시 시도해 주세요.',
  },
  {
    exact:
      'This print order is already cancelled; it cannot go back to production',
    copy: '이미 취소된 인쇄 발주라 생산 진행으로 되돌릴 수 없습니다.',
  },
  {
    prefix: 'Only failed or unsupported print orders can be retried (current:',
    copy: '발주 실패 또는 미지원 품목만 재전송할 수 있습니다. 새로고침 후 다시 확인해 주세요.',
  },
  {
    prefix: 'Only refused or stuck cancellations can be resolved (current:',
    copy: '취소 확인이 필요한 건만 처리할 수 있습니다. 새로고침 후 다시 확인해 주세요.',
  },
];

export function printOrderServerMessageCopy(message: string): string {
  const hit = PRINT_ORDER_ERROR_COPY.find((e) =>
    e.exact !== undefined
      ? e.exact === message
      : e.prefix !== undefined && message.startsWith(e.prefix)
  );
  return hit ? hit.copy : message;
}
