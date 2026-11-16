import type { BoxDraft, ConfirmBlock, ScanTarget } from '../../domains/inbound-shipment/boxDraft';
import type { BoxLine } from '../../domains/inbound-shipment/types';

/** 그리드의 한 줄 — 리스트 줄(서버 행 순서) 뒤에 이 상자에서 더한 «리스트에 없던 물건» */
export type BoxRow = { kind: 'line'; line: BoxLine } | { kind: 'unplanned'; item: BoxDraft['unplanned'][number] };

export const rowKey = (row: BoxRow): string => (row.kind === 'line' ? `line:${row.line.lineId}` : `unplanned:${row.item.skuId}`);

export const rowsOf = (lines: BoxLine[], draft: BoxDraft): BoxRow[] => [
  ...lines.map((line): BoxRow => ({ kind: 'line', line })),
  ...draft.unplanned.map((item): BoxRow => ({ kind: 'unplanned', item })),
];

export const fmt = (n: number): string => n.toLocaleString('ko-KR');

/** 범위 줄의 덮는 상자 — «L5~L9» */
export const coverRange = (line: BoxLine): string =>
  `${line.coversBoxLabels[0]}~${line.coversBoxLabels[line.coversBoxLabels.length - 1]}`;

export const targetKey = (t: ScanTarget): string => (t.kind === 'line' ? `line:${t.lineId}` : `unplanned:${t.skuId}`);

/**
 * 확정을 막은 까닭(`confirmBlock`) → 작업자에게 보일 한 줄과 커서를 옮길 줄.
 * `not_stock_open` 은 문구가 아니라 상자를 다시 여는 것이라 null.
 */
export function blockNotice(block: Exclude<ConfirmBlock, null>): { message: string; focus?: string } | null {
  switch (block.reason) {
    case 'blank':
      return { message: `빈칸 ${block.lineIds.length}줄`, focus: `line:${block.lineIds[0]}` };
    case 'stale_list':
      return { message: `리스트가 바뀌었어요 — ${block.lineIds.length}줄 다시 확인`, focus: `line:${block.lineIds[0]}` };
    case 'unplanned_on_list':
      return {
        message: '리스트에 있는 상품이에요 — 리스트에 없던 물건에서 빼고 그 줄에 넣어 주세요',
        focus: `unplanned:${block.skuIds[0]}`,
      };
    case 'empty_added_box':
      return { message: '리스트에 없던 물건을 하나 이상 넣어 주세요' };
    case 'unresolved':
      return { message: '관리자 화면에서 줄을 정해야 해요' };
    case 'not_stock_open':
      return null;
  }
}
