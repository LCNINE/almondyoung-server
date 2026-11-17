import {
  COUPANG_SHIPPED_BOX_STATUSES,
  CoupangOrderSheetInfo,
  parseCoupangOrderSheet,
} from '../../../apps/channel-adapter/src/services/order-collection/coupang-order-fields';

export interface RehearsalOrderReport {
  /** 결제완료 주문인데 출고(DEPARTURE 이후)된 상자가 섞인 주문번호 — 컷오버에서 사람이 처리한다(런북) */
  acceptWithShippedBox: string[];
  /** source 가 «같은 옵션 두 줄» 로 격리할 주문번호 — 주문의 상자 전부를 합쳐 본다(`assertDistinctVendorItems` 와 같은 규칙) */
  twoLineOrders: string[];
  /** `<주문번호>: <해석 오류>` */
  parseFailures: string[];
}

/**
 * 주문마다 발주서 «전부»(단건 조회 응답)로 컷오버 보고의 숫자를 낸다. 주문번호만 싣는다 — 개인정보는 싣지 않는다.
 * 같은 상자가 두 번 오면(스캔·단건이 겹침) 하나로 본다 — source 의 상자 중복 제거와 같다.
 */
export function summarizeOrders(input: {
  acceptOrderIds: ReadonlySet<string>;
  sheetsByOrder: ReadonlyMap<string, readonly unknown[]>;
}): RehearsalOrderReport {
  const report: RehearsalOrderReport = { acceptWithShippedBox: [], twoLineOrders: [], parseFailures: [] };
  for (const [orderId, raws] of input.sheetsByOrder) {
    const boxes = new Map<string, CoupangOrderSheetInfo>();
    for (const raw of raws) {
      try {
        const info = parseCoupangOrderSheet(raw);
        boxes.set(info.shipmentBoxId, info);
      } catch (error) {
        report.parseFailures.push(`${orderId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const sheets = [...boxes.values()];
    if (input.acceptOrderIds.has(orderId) && sheets.some((info) => COUPANG_SHIPPED_BOX_STATUSES.has(info.status))) {
      report.acceptWithShippedBox.push(orderId);
    }
    const optionIds = sheets.flatMap((info) => info.items.map((item) => item.vendorItemId));
    if (new Set(optionIds).size !== optionIds.length) report.twoLineOrders.push(orderId);
  }
  return report;
}
