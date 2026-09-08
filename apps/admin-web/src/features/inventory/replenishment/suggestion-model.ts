import type {
  AddToCartRequest,
  CreateTransferOrderRequest,
  PurchaseOrderType,
  ReplenishmentSuggestionRowDto,
  SuggestionActionDto,
  SuggestionFlag,
} from '@/lib/types/dto/inventory';

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
  legacy_only: '정적 안전재고',
};
