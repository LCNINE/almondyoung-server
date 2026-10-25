import type { SheetResponse } from '@/lib/api/domains/orders/direct-ship.client';
import { sheetDownloadDecision } from './supplier-sheet-xlsx';

export interface HandoffOutcome {
  /** 파일로 만들어 내려받는다 */
  download: boolean;
  /** 가린 시트라 만들지 않았다(N3) */
  maskedMessage: string | null;
  /** 받는 분 정보가 빠져 넘기지 않은 상자 — 대기로 남는다 */
  skipped: { message: string; shipmentIds: string[] } | null;
}

/** 넘김·다시 받기 응답을 화면이 할 일로 옮긴다 */
export function handoffOutcome({ sheet, pii }: SheetResponse): HandoffOutcome {
  const decision = sheetDownloadDecision(pii);
  const ids = sheet.skippedShipments.map((s) => s.shipmentId);
  return {
    download: decision.ok,
    maskedMessage: decision.ok ? null : decision.message,
    skipped:
      ids.length === 0
        ? null
        : { message: `받는 분 정보가 빠진 상자 ${ids.length}개는 넘기지 않았습니다`, shipmentIds: ids },
  };
}
