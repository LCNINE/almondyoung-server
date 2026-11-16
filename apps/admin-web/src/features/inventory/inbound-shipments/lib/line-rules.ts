import type {
  InboundShipmentBox,
  InboundShipmentDetail,
  InboundShipmentLine,
  LineIssueCode,
} from '@/lib/types/dto/inbound-shipment';

/**
 * 사람이 한 번 봐야 하는 경고 코드. 나머지는 미확인을 만드는 코드라 kind==='unresolved' 로 이미 잡히고,
 * forward_hint·contact_hint 는 표시만 한다.
 */
export const WARNING_ISSUES: ReadonlySet<LineIssueCode> = new Set<LineIssueCode>([
  'box_label_guess',
  'box_range_invalid',
  'qty_formula',
  'option_date_coerced',
  'packing_unit_barcode',
]);

export function needsAttention(line: InboundShipmentLine): boolean {
  return line.kind === 'unresolved' || line.issues.some((c) => WARNING_ISSUES.has(c));
}

const ISSUE_LABELS: Record<LineIssueCode, string> = {
  box_label_guess: '상자 이름을 추측했습니다',
  box_label_missing: '상자 이름이 없습니다',
  box_range_invalid: '상자 범위가 이상합니다',
  box_label_too_long: '상자 이름이 너무 깁니다',
  qty_formula: '수량이 수식입니다',
  qty_invalid: '수량을 읽을 수 없습니다',
  barcode_missing: '바코드가 없습니다',
  barcode_is_text: '바코드가 글자로 되어 있습니다',
  foreign_code: '외국 코드입니다',
  barcode_not_found: '바코드에 맞는 SKU 가 없습니다',
  barcode_ambiguous: '바코드가 여러 SKU 에 걸립니다',
  packing_unit_barcode: '묶음 단위 바코드입니다',
  option_date_coerced: '옵션이 날짜로 바뀌었을 수 있습니다',
  forward_hint: '전달용으로 보이는 표시가 있습니다',
  contact_hint: '연락처 표시가 있습니다',
};

export function issueLabel(code: LineIssueCode): string {
  return ISSUE_LABELS[code];
}

export function prefillSearchText(line: InboundShipmentLine): string {
  return line.raw.productName?.text?.trim() ?? '';
}

export function skuSearchQueries(input: string): Array<{ barcode: string } | { code: string } | { name: string }> {
  const text = input.trim();
  if (text === '') return [];
  if (/^\d{8,}$/.test(text)) return [{ barcode: text }, { code: text }];
  return [{ name: text }];
}

function coveredBoxes(shipment: InboundShipmentDetail, line: InboundShipmentLine): InboundShipmentBox[] {
  const labels = new Set(line.coversBoxLabels);
  return shipment.boxes.filter((b) => labels.has(b.label));
}

export function lineEditability(
  shipment: InboundShipmentDetail,
  line: InboundShipmentLine,
): { editable: true } | { editable: false; reason: string } {
  switch (shipment.status) {
    case 'draft':
      return { editable: true };
    case 'closed':
      return { editable: false, reason: '끝난 선적입니다. 다시 열어야 고칠 수 있습니다' };
    case 'canceled':
      return { editable: false, reason: '취소된 선적입니다' };
    default:
      return coveredBoxes(shipment, line).every((b) => b.status === 'open')
        ? { editable: true }
        : { editable: false, reason: '받은 상자가 있어 고칠 수 없습니다' };
  }
}

export function differenceText(line: InboundShipmentLine, coveredBoxes: InboundShipmentBox[]): string {
  const { state, counted, expected } = line.difference;
  switch (state) {
    case 'pending':
      return `진행 중 (받은 상자 ${coveredBoxes.filter((b) => b.status === 'received').length}/${coveredBoxes.length})`;
    case 'match':
      return '맞음';
    case 'short':
      return `모자람 ${(expected ?? 0) - counted}`;
    case 'over':
      return `남음 ${counted - (expected ?? 0)}`;
    case 'not_arrived':
      return '안 옴';
  }
}

/** «차이 있는 줄만» — 모자람·남음·안 옴. 맞음·진행 중은 차이가 아니다. */
export function hasDifference(line: InboundShipmentLine): boolean {
  const { state } = line.difference;
  return state === 'short' || state === 'over' || state === 'not_arrived';
}
