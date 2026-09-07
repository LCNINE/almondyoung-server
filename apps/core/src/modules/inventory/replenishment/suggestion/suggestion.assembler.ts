import { roundUpToLot } from '../policy/rounding';
import {
  AssembleContext,
  CompanyAxis,
  SellableAxis,
  SkuStockInput,
  SuggestionAction,
  SuggestionFlag,
  SuggestionRow,
} from './suggestion.types';

/**
 * 두 축 판정 (스펙 §7.2). 순수 함수 — Nest · drizzle 을 모른다.
 *
 * C 단계 자리표시 규칙(스펙 §9): 안전재고 = 재주문점 = 목표수준 = skus.safety_stock,
 * 리드타임 0, 수요 0. A+B 단계가 프로필과 규칙으로 이 상수들을 교체한다. 그때 바뀌는 것은
 * `levelsFor` 하나여야 한다 — 축 판정 자체는 그대로다.
 */
export function assembleSuggestions(inputs: SkuStockInput[], ctx: AssembleContext): SuggestionRow[] {
  const rows = inputs.filter((input) => !input.excluded).map((input) => assembleOne(input, ctx));
  rows.sort((a, b) => a.sellable.position - a.sellable.reorderPoint - (b.sellable.position - b.sellable.reorderPoint));
  return rows;
}

function assembleOne(input: SkuStockInput, ctx: AssembleContext): SuggestionRow {
  const levels = levelsFor(input);

  const company: CompanyAxis = {
    onHand: input.onHandTotal,
    inTransfer: input.inTransferTotal,
    onOrder: input.onOrderTotal,
    reserved: input.reservedTotal,
    position: input.onHandTotal + input.inTransferTotal + input.onOrderTotal - input.reservedTotal,
    ...levels,
  };

  const onOrderDirect = input.onOrderTotal - input.onOrderNonSellable;
  const sellable: SellableAxis = {
    warehouseId: ctx.sellableWarehouseId,
    onHand: input.onHandSellable,
    reserved: input.reservedSellable,
    inTransit: input.inTransitToSellable,
    onOrderDirect,
    position: input.onHandSellable - input.reservedSellable + input.inTransitToSellable + onOrderDirect,
    daysOfCover: null,
    ...levels,
  };

  const actions: SuggestionAction[] = [];

  // First determine if/how much transfer will happen
  let transferAction: SuggestionAction | null = null;
  let transferQty = 0;
  if (sellable.position <= sellable.reorderPoint) {
    const sellableDeficit = Math.ceil(sellable.targetLevel - sellable.position);
    transferAction = planTransfer(input, ctx, sellableDeficit);
    if (transferAction) transferQty = transferAction.qty;
  }

  // Check if company needs purchase
  // Purchase is generated if company position is low, and only if the deficit exceeds what transfer provides
  if (company.position <= company.reorderPoint) {
    const companyDeficit = company.targetLevel - company.position;
    // Only purchase if we can't fully cover company deficit with transfer
    if (companyDeficit > transferQty) {
      const qty = roundUpToLot(companyDeficit, input.lot);
      if (qty > 0) {
        actions.push({ type: 'purchase', qty, supplierId: input.supplier?.id ?? null, sourceWarehouseId: null });
      }
    }
  }

  if (transferAction) actions.push(transferAction);

  const flags: SuggestionFlag[] = ['legacy_only'];
  if (!input.supplier) flags.push('supplier_unknown');

  return {
    skuId: input.skuId,
    skuCode: input.skuCode,
    skuName: input.skuName,
    supplier: input.supplier,
    pattern: 'insufficient',
    grade: 'C',
    confidence: 'low',
    demand: { dailyMean: 0, dailyStd: 0 },
    company,
    sellable,
    actions,
    flags,
    legacyReorderPoint: levels.reorderPoint,
  };
}

/** C 단계: 세 수준이 전부 정적 안전재고다. */
function levelsFor(input: SkuStockInput) {
  return {
    safetyStock: input.safetyStock,
    reorderPoint: input.safetyStock,
    targetLevel: input.safetyStock,
    leadTimeDays: 0,
  };
}

/**
 * 이동가능 = 비판매 ON_HAND − draft 지시서 planned. 큰 로케이션부터 채운다.
 * 이동량은 올리지 않는다 — 있는 만큼만 옮긴다(스펙 §5.3).
 */
function planTransfer(input: SkuStockInput, ctx: AssembleContext, need: number): SuggestionAction | null {
  const movableTotal = input.nonSellableOnHand.reduce((sum, row) => sum + row.qty, 0) - input.draftTransferPlanned;
  const qty = Math.min(movableTotal, need);
  if (qty <= 0) return null;

  const sources = [...input.nonSellableOnHand].sort((a, b) => b.qty - a.qty);
  const fromWarehouseId = sources[0].warehouseId;
  const lines: Array<{ fromLocationId: string; quantity: number }> = [];
  let remaining = qty;
  for (const source of sources) {
    if (remaining <= 0) break;
    if (source.warehouseId !== fromWarehouseId) continue;
    const take = Math.min(source.qty, remaining);
    if (take <= 0) continue;
    lines.push({ fromLocationId: source.locationId, quantity: take });
    remaining -= take;
  }
  const lineTotal = lines.reduce((sum, line) => sum + line.quantity, 0);
  return { type: 'transfer', qty: lineTotal, fromWarehouseId, toWarehouseId: ctx.sellableWarehouseId, lines };
}
