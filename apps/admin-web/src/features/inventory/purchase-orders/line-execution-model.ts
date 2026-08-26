import type {
  PurchaseOrderDto,
  PurchaseOrderLineDto,
  PurchaseOrderLineStatus,
  PurchaseOrderStatus,
} from '@/lib/types/dto/inventory';

export type LineProgress = {
  total: number;
  requested: number;
  ordered: number;
  unavailable: number;
};

export function summarizeLines(lines: PurchaseOrderLineDto[]): LineProgress {
  return lines.reduce<LineProgress>(
    (acc, line) => {
      acc.total += 1;
      acc[line.status] += 1;
      return acc;
    },
    { total: 0, requested: 0, ordered: 0, unavailable: 0 }
  );
}

export function formatLineProgress(progress: LineProgress): string {
  if (progress.total === 0) return '라인 없음';
  const parts = [`${progress.ordered}/${progress.total} 실행`];
  if (progress.unavailable > 0) parts.push(`${progress.unavailable} 불가`);
  return parts.join(' · ');
}

const STATUS_ORDER: Record<PurchaseOrderLineStatus, number> = {
  requested: 0,
  ordered: 1,
  unavailable: 2,
};

/** 아직 처리할 라인을 위로. 같은 상태끼리는 품목명(없으면 SKU ID) 사전순. */
export function sortLinesForExecution(lines: PurchaseOrderLineDto[]): PurchaseOrderLineDto[] {
  return [...lines].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return (a.sku?.name ?? a.skuId).localeCompare(b.sku?.name ?? b.skuId, 'ko');
  });
}

/**
 * received 는 입고 경로가 소유한 종결 상태다. core 의
 * lockPurchaseOrderForLineExecution 이 그 상태의 라인 실행을 400 으로 막으므로,
 * 화면은 버튼을 눌러 실패를 보여주는 대신 아예 감춘다.
 */
export function canExecuteLines(poStatus: PurchaseOrderStatus): boolean {
  return poStatus !== 'received';
}

export function isLineExecutable(
  poStatus: PurchaseOrderStatus,
  line: PurchaseOrderLineDto
): boolean {
  return canExecuteLines(poStatus) && line.status === 'requested';
}

/**
 * 달력 날짜만 잘라낸다. `new Date(v)` 왕복을 쓰지 않는 이유는 그것이 런타임 TZ 에
 * 따라 하루를 밀기 때문이다 (#724 발견 ⑪). ISO 8601 은 어떤 형태든 앞 10자가
 * 그 달력 날짜라는 성질만 쓴다.
 */
export function toCalendarDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

export type OrderDialogDefaults = {
  orderedQty: string;
  unitPrice: string;
  expectedArrival: string;
};

export function orderDialogDefaults(
  po: PurchaseOrderDto,
  line: PurchaseOrderLineDto
): OrderDialogDefaults {
  return {
    orderedQty: String(line.quantity),
    unitPrice: line.unitPrice != null ? String(line.unitPrice) : '',
    expectedArrival: toCalendarDate(line.expectedArrival ?? po.expectedArrival),
  };
}

export type OrderLineFormValues = {
  orderedQty: string;
  unitPrice: string;
  expectedArrival: string;
};

export type OrderLinePayload = {
  orderedQty: number;
  unitPrice?: number;
  expectedArrival?: string;
};

export type OrderLinePayloadResult =
  | { ok: true; payload: OrderLinePayload }
  | { ok: false; reason: string };

const CALENDAR_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 달력에 실제로 존재하는 'YYYY-MM-DD' 인지 본다. 모양만 보는 정규식은
 * '2026-02-31' 을 통과시킨다 — core 의 isCalendarDate
 * (libs/shared/src/validators/calendar-date.validator.ts) 가 그 이유를 적어놨고,
 * 여기서 같은 왕복 비교를 쓴다.
 *
 * 이 `new Date` 는 값을 도출하지 않는다 — 'Z' 로 UTC 에 고정한 검증 전용이라
 * 런타임 TZ 와 무관하다. 날짜 값을 만들 때는 여전히 slice 만 쓴다(toCalendarDate).
 */
function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_SHAPE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * 폼 문자열을 요청 본문으로 옮긴다. 검사 기준은 core 의 OrderPurchaseOrderLineDto 와
 * 같다 — @IsInt @Min(1) / @IsInt @Min(0) / @Validate(IsCalendarDateConstraint).
 * 서버가 어차피 막지만, 되돌릴 수 없는 액션이라 왕복 전에 여기서도 막는다.
 */
export function buildOrderLinePayload(values: OrderLineFormValues): OrderLinePayloadResult {
  const orderedQty = Number(values.orderedQty);
  if (!Number.isInteger(orderedQty) || orderedQty < 1) {
    return { ok: false, reason: '실발주 수량은 1 이상의 정수여야 합니다.' };
  }

  const payload: OrderLinePayload = { orderedQty };

  if (values.unitPrice.trim()) {
    const unitPrice = Number(values.unitPrice);
    if (!Number.isInteger(unitPrice) || unitPrice < 0) {
      return { ok: false, reason: '단가는 0 이상의 정수여야 합니다.' };
    }
    payload.unitPrice = unitPrice;
  }

  if (values.expectedArrival.trim()) {
    if (!isCalendarDate(values.expectedArrival)) {
      return { ok: false, reason: '도착예정일은 달력에 존재하는 날짜를 YYYY-MM-DD 형식으로 입력하세요.' };
    }
    payload.expectedArrival = values.expectedArrival;
  }

  return { ok: true, payload };
}

/**
 * 「라인 수정」(PUT /:id/lines)은 아직 requested 인 라인만 갈아끼운다. 종결된 라인을
 * 폼에 실어 보내면 core 가 closedSkuIds 로 걸러내 편집이 조용히 사라진다 —
 * 성공 토스트가 뜨고 값은 되돌아온다. 그래서 폼에 아예 싣지 않는다.
 */
export function partitionLinesForEdit(lines: PurchaseOrderLineDto[]): {
  editable: PurchaseOrderLineDto[];
  closed: PurchaseOrderLineDto[];
} {
  return {
    editable: lines.filter((line) => line.status === 'requested'),
    closed: lines.filter((line) => line.status !== 'requested'),
  };
}
