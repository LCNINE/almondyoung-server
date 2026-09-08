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
 * 상태코드 판독. `lib/api/client.ts` 인터셉터가 401 · 4xx · 5xx · 재시도 소진 등 모든 실패
 * 경로에서 `CustomError` 를 던지므로(원형 `AxiosError` 가 통과하는 경로가 없다) axios 원형
 * `error.response.status` 를 볼 일이 없다 — 그런 옛 폴백 분기는 프로덕션 호출자 0으로
 * 죽은 코드였다(#743 B 리뷰 R32-⑤). `CustomError` 가 아니면 null.
 */
export function httpStatusOf(error: unknown): number | null {
  return isCustomError(error) ? error.statusCode : null;
}

/** 서버 메시지 판독. 위 `httpStatusOf` 와 같은 이유로 `CustomError` 경로만 본다. */
export function serverMessageOf(error: unknown): string | null {
  return isCustomError(error) ? error.message || null : null;
}
