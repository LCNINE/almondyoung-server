import type {
  AddToCartRequest,
  CreateTransferOrderRequest,
  DemandPattern,
  ParameterSource,
  PurchaseOrderType,
  ReplenishmentSuggestionRowDto,
  SuggestionActionDto,
  SuggestionFlag,
} from '@/lib/types/dto/inventory';
import { isCustomError } from '@/lib/api/customError';

type PurchaseAction = Extract<SuggestionActionDto, { type: 'purchase' }>;
type TransferAction = Extract<SuggestionActionDto, { type: 'transfer' }>;

export function purchaseAction(
  row: ReplenishmentSuggestionRowDto
): PurchaseAction | null {
  const found = row.actions.find(
    (a): a is PurchaseAction => a.type === 'purchase'
  );
  return found ?? null;
}

export function transferAction(
  row: ReplenishmentSuggestionRowDto
): TransferAction | null {
  const found = row.actions.find(
    (a): a is TransferAction => a.type === 'transfer'
  );
  return found ?? null;
}

export function summarizeActions(row: ReplenishmentSuggestionRowDto): string {
  const parts: string[] = [];
  const purchase = purchaseAction(row);
  const transfer = transferAction(row);
  if (purchase) parts.push(`발주 ${purchase.qty}`);
  if (transfer) parts.push(`이동 ${transfer.qty}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function toCartPayload(
  row: ReplenishmentSuggestionRowDto,
  purchase: PurchaseAction,
  type: PurchaseOrderType
): AddToCartRequest {
  const payload: AddToCartRequest = {
    skuId: row.skuId,
    quantity: purchase.qty,
    type,
  };
  if (purchase.supplierId) payload.supplierId = purchase.supplierId;
  return payload;
}

export function toTransferPayload(
  row: ReplenishmentSuggestionRowDto,
  transfer: TransferAction,
  memo?: string
): CreateTransferOrderRequest {
  return {
    fromWarehouseId: transfer.fromWarehouseId,
    toWarehouseId: transfer.toWarehouseId,
    ...(memo ? { memo } : {}),
    lines: transfer.lines.map((line) => ({
      skuId: row.skuId,
      fromLocationId: line.fromLocationId,
      quantity: line.quantity,
    })),
  };
}

export function urgencyLabel(row: ReplenishmentSuggestionRowDto): string {
  const gap = row.sellable.position - row.sellable.reorderPoint;
  return gap < 0 ? `부족 ${-gap}` : `여유 ${gap}`;
}

export const FLAG_LABELS: Record<SuggestionFlag, string> = {
  default_lead_time: '기본 리드타임',
  supplier_unknown: '공급사 미정',
  low_confidence: '신뢰도 낮음',
};

export const PO_TYPE_LABELS: Record<PurchaseOrderType, string> = {
  foreign: '해외',
  domestic: '국내',
};

export const PATTERN_LABELS: Record<DemandPattern, string> = {
  smooth: '안정',
  intermittent: '간헐',
  erratic: '변동',
  lumpy: '불규칙',
  insufficient: '이력 부족',
  none: '수요 없음',
};

export const SOURCE_LABELS: Record<ParameterSource, string> = {
  override: 'SKU 예외',
  grade: '등급 규칙',
  observation: '관측',
  supplier_rule: '공급사 규칙',
  route_rule: '경로 규칙',
  global_default: '전역 기본',
};

/** 예상 커버 일수 표기. null(일평균 0) 은 '—'. */
export function daysOfCoverLabel(row: ReplenishmentSuggestionRowDto): string {
  const d = row.sellable.daysOfCover;
  if (d === null) return '—';
  if (d <= 0) return '소진';
  return `${d}일`;
}

/**
 * 상태코드 판독. axios 인터셉터(`lib/api/client.ts`)가 4xx·5xx 를 전부 `CustomError` 로 던지므로
 * 프로덕션 호출자는 이 경로가 정본이다 — `error.response.status` 만 보던 옛 분기는 라이브에서
 * 항상 null 이었다(#743 B 리뷰). `CustomError` 가 아닌 형태(원시 axios 오류 등)도 방어적으로 읽는다.
 */
export function httpStatusOf(error: unknown): number | null {
  if (isCustomError(error)) return error.statusCode;
  if (typeof error !== 'object' || error === null) return null;
  if (!('response' in error)) return null;
  const { response } = error;
  if (typeof response !== 'object' || response === null) return null;
  if (!('status' in response)) return null;
  const { status } = response;
  return typeof status === 'number' ? status : null;
}

/** 서버 메시지 판독. `CustomError` 가 정본, 아니면 axios 원시 형태(`response.data.message`)를 본다. */
export function serverMessageOf(error: unknown): string | null {
  if (isCustomError(error)) return error.message || null;
  if (typeof error !== 'object' || error === null) return null;
  if (!('response' in error)) return null;
  const { response } = error;
  if (typeof response !== 'object' || response === null) return null;
  if (!('data' in response)) return null;
  const { data } = response;
  if (typeof data !== 'object' || data === null) return null;
  if (!('message' in data)) return null;
  const { message } = data;
  return typeof message === 'string' ? message : null;
}
