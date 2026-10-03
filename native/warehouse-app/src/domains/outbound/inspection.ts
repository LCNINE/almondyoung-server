import { ApiError } from '../../core/data/httpClient';
import type { ShipmentByWaybill, ShipmentByWaybillLine, SimpleOutboundLineProgress } from './types';
import { labelGateOf } from './labelGate';
import type { LabelItemChange } from './waybillLabel';

/** 송장 스캔 결과 → 출고 검수(F1) 화면(스테이션 UI 스펙 §6.2) */
export type InspectionGate =
  | { kind: 'inspect' }
  | { kind: 'reprint'; changes: LabelItemChange[] }
  | { kind: 'withdraw' }
  | { kind: 'withdrawn' }
  | { kind: 'reject'; message: string };

export const NOT_IN_TODAY_MESSAGE = '이 송장은 오늘 배치에 없어요 — 관리자에게 문의해 주세요';
export const PRINT_ELSEWHERE_MESSAGE = '송장을 새로 출력해야 해요. 프린터 있는 자리에서 출력해 주세요.';

/**
 * 순서가 뜻을 가진다: 빠진 박스는 작업 항목이 없으므로 «오늘 배치에 없음» 보다 먼저 본다.
 * 서버의 전진 명령도 같은 조건으로 막는다(I5) — 이건 헛걸음 방지다.
 */
export function inspectionGateOf(found: ShipmentByWaybill, ctx: { warehouseId: string; canPrint: boolean }): InspectionGate {
  if (found.warehouseId && found.warehouseId !== ctx.warehouseId)
    return { kind: 'reject', message: '송장의 창고와 선택 창고가 달라요. 창고를 확인해 주세요.' };
  if (found.shipmentStatus === 'shipped') return { kind: 'reject', message: '이미 출고된 송장이에요' };
  if (found.labelState === 'withdrawn') return { kind: 'withdrawn' };
  if (found.labelState === 'withdrawing') return { kind: 'withdraw' };
  if (found.workItemId === null) return { kind: 'reject', message: NOT_IN_TODAY_MESSAGE };
  switch (found.labelState) {
    case 'not_started':
      return { kind: 'reject', message: '배치 현황(F2)에서 「작업 시작」을 먼저 눌러 주세요.' };
    case 'unavailable': {
      // 무효 송장/확인 불가 문구는 labelGate 와 같은 것을 쓴다
      const gate = labelGateOf(found, ctx.canPrint);
      return { kind: 'reject', message: gate.kind === 'blocked' ? gate.message : '송장 상태를 확인할 수 없어요. 관리자에게 문의해 주세요.' };
    }
    case 'never_printed':
    case 'reprint_required':
      return ctx.canPrint ? { kind: 'reprint', changes: found.labelChanges } : { kind: 'reject', message: PRINT_ELSEWHERE_MESSAGE };
    default:
      return { kind: 'inspect' };
  }
}

export type InspectScanKind = 'same-waybill' | 'maybe-waybill' | 'product';

const digitsOf = (value: string) => value.replace(/\D/g, '');

/**
 * 검수 중 스캔이 송장인가 상품인가(계획이 정함). 같은 배치의 송장은 같은 택배사 형식이라, 숫자만이고 지금 송장번호와
 * 길이가 같으면 송장일 수 있다 — 화면이 조회해 보고 없으면(404) 상품으로 넘긴다. 짧은 송장번호(10자리 미만)로는 의심하지 않는다.
 */
export function classifyInspectScan(code: string, trackingNo: string): InspectScanKind {
  const own = digitsOf(trackingNo);
  if (code === trackingNo || (own.length > 0 && code === own)) return 'same-waybill';
  return own.length >= 10 && /^\d+$/.test(code) && code.length === own.length ? 'maybe-waybill' : 'product';
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** 조회 결과의 줄 진행. 전량 검수 전까지 inspectedQty 가 0 이라 pickedQty 를 우선한다(SimpleOutboundScreen 과 같은 규칙). */
export function progressOf(found: Pick<ShipmentByWaybill, 'lines'>): SimpleOutboundLineProgress[] {
  return found.lines.map((line) => ({
    shipmentLineId: line.shipmentLineId,
    skuId: line.skuId,
    qty: line.qty,
    pickedQty: Math.max(line.pickedQty, line.inspectedQty),
    inspectedQty: line.inspectedQty,
  }));
}

export interface InspectionRow {
  shipmentLineId: string;
  name: string;
  /** 배정 위치(송장 순서)와 위치별 수량 — 보여 주기만 한다(§6.4). 옛 core 면 [] */
  locations: Array<{ code: string; qty: number }>;
  ordered: number;
  scanned: number;
  done: boolean;
}

/** 송장 품목 줄 순서(로케이션 코드 순 — core 의 collate "C" 와 같은 코드 단위 비교). 위치 없는 줄은 뒤로, 같으면 원래 순서. */
function byLocation(a: InspectionRow, b: InspectionRow): number {
  const left = a.locations.map((l) => l.code).join(' ');
  const right = b.locations.map((l) => l.code).join(' ');
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left < right ? -1 : 1;
}

export function inspectionRows(
  lines: readonly ShipmentByWaybillLine[],
  progress: readonly SimpleOutboundLineProgress[]
): InspectionRow[] {
  const scannedOf = new Map(progress.map((p) => [p.shipmentLineId, p.pickedQty]));
  return lines
    .map((line) => {
      const scanned = scannedOf.get(line.shipmentLineId) ?? 0;
      return {
        shipmentLineId: line.shipmentLineId,
        name: line.skuName,
        locations: (line.allocations ?? []).map((a) => ({ code: a.locationCode, qty: a.qty })),
        ordered: line.qty,
        scanned,
        done: scanned >= line.qty,
      };
    })
    .sort(byLocation);
}

export function inspectionTotals(rows: readonly InspectionRow[]): { scanned: number; ordered: number } {
  return rows.reduce(
    (total, row) => ({ scanned: total.scanned + Math.min(row.scanned, row.ordered), ordered: total.ordered + row.ordered }),
    { scanned: 0, ordered: 0 }
  );
}

/** 이번 스캔으로 오른 줄 — «이 상품 전량»(F8)과 표의 진행 줄이 쓴다 */
export function scannedLineOf(
  before: readonly SimpleOutboundLineProgress[],
  after: readonly SimpleOutboundLineProgress[]
): string | null {
  const previous = new Map(before.map((p) => [p.shipmentLineId, p.pickedQty]));
  return after.find((p) => p.pickedQty > (previous.get(p.shipmentLineId) ?? 0))?.shipmentLineId ?? null;
}

export function remainingOf(progress: readonly SimpleOutboundLineProgress[], shipmentLineId: string): number {
  const line = progress.find((p) => p.shipmentLineId === shipmentLineId);
  return line ? Math.max(0, line.qty - line.pickedQty) : 0;
}

export function formatTrackingNo(trackingNo: string): string {
  return /^\d{12}$/.test(trackingNo) ? trackingNo.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3') : trackingNo;
}
