import type { SheetResponse } from '@/lib/api/domains/orders/direct-ship.client';
import { sheetDownloadDecision } from './supplier-sheet-xlsx';

export interface HandoffOutcome {
  /** 파일로 만들어 내려받는다 */
  download: boolean;
  /** 가린 시트라 만들지 않았다(N3) */
  maskedMessage: string | null;
  /** 받는 분 정보가 빠져 시트에 싣지 않은 상자 */
  skipped: { message: string; shipmentIds: string[] } | null;
  /** 실을 줄이 하나도 없어 내려받지 않았다(다시 받기만) */
  emptyMessage: string | null;
}

export const REDOWNLOAD_EMPTY_MESSAGE = '다시 받을 상자가 없습니다';

function skippedOf(sheet: SheetResponse['sheet'], message: (n: number) => string): HandoffOutcome['skipped'] {
  const ids = sheet.skippedShipments.map((s) => s.shipmentId);
  return ids.length === 0 ? null : { message: message(ids.length), shipmentIds: ids };
}

/** 넘김 응답을 화면이 할 일로 옮긴다 — 빠진 상자는 넘기지 않았으니 대기로 남는다 */
export function handoffOutcome({ sheet, pii }: SheetResponse): HandoffOutcome {
  const decision = sheetDownloadDecision(pii);
  return {
    download: decision.ok,
    maskedMessage: decision.ok ? null : decision.message,
    skipped: skippedOf(sheet, (n) => `받는 분 정보가 빠진 상자 ${n}개는 넘기지 않았습니다`),
    emptyMessage: null,
  };
}

/**
 * 다시 받기 응답을 화면이 할 일로 옮긴다. 빠진 상자는 넘김이 찍힌 채 이 시트에서만 빠졌으니 반드시 알린다 —
 * 말하지 않으면 입점사도 운영자도 그 상자를 못 본다. 실을 줄이 없으면(다 발송했거나 다 빠짐) 머리글뿐인
 * 파일을 받지 않는다. 그때는 가림 문구도 내지 않는다 — 다시 받으라는 안내가 헛걸음이 된다.
 */
export function redownloadOutcome({ sheet, pii }: SheetResponse): HandoffOutcome {
  const skipped = skippedOf(sheet, (n) => `받는 분 정보가 빠진 상자 ${n}개는 이 시트에 싣지 않았습니다`);
  if (sheet.rows.length === 0) {
    return { download: false, maskedMessage: null, skipped, emptyMessage: REDOWNLOAD_EMPTY_MESSAGE };
  }
  const decision = sheetDownloadDecision(pii);
  return {
    download: decision.ok,
    maskedMessage: decision.ok ? null : decision.message,
    skipped,
    emptyMessage: null,
  };
}
