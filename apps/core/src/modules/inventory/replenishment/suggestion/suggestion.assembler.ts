import { roundUpToLot } from '../policy/rounding';
import {
  AssembleContext,
  AxisLevels,
  CompanyAxis,
  SellableAxis,
  SkuStockInput,
  SuggestionAction,
  SuggestionFlag,
  SuggestionRow,
} from './suggestion.types';

/**
 * 두 축 판정 (스펙 §7.2). 순수 함수 — Nest · drizzle 을 모른다.
 * 수준(SS · ROP · S · L)은 정책 층이 축마다 계산해 `levels` 로 넘긴다 — 여기서는 판정만 한다.
 * 정렬은 예상 커버 일수(IP_판매 ÷ μ_D) 오름차순, null(μ_D = 0) 은 뒤, 동률은 SKU 코드순.
 */
export function assembleSuggestions(inputs: SkuStockInput[], ctx: AssembleContext): SuggestionRow[] {
  const rows = inputs.filter((input) => !input.excluded).map((input) => assembleOne(input, ctx));
  rows.sort(byUrgency);
  return rows;
}

/** 동률 타이브레이크는 코드순. `localeCompare()` 는 서버 로케일에 따라 순서가 달라지므로 쓰지 않는다. */
function byCode(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byUrgency(a: SuggestionRow, b: SuggestionRow): number {
  const da = a.sellable.daysOfCover;
  const db = b.sellable.daysOfCover;
  if (da === null && db === null) return byCode(a.skuCode, b.skuCode);
  if (da === null) return 1;
  if (db === null) return -1;
  return da - db || byCode(a.skuCode, b.skuCode);
}

function daysOfCover(position: number, dailyMean: number): number | null {
  if (!(dailyMean > 0)) return null;
  return Math.round((position / dailyMean) * 10) / 10;
}

function assembleOne(input: SkuStockInput, ctx: AssembleContext): SuggestionRow {
  const companyLevels: AxisLevels = input.levels.company;
  const sellableLevels: AxisLevels = input.levels.sellable;

  const company: CompanyAxis = {
    onHand: input.onHandTotal,
    inTransfer: input.inTransferTotal,
    onOrder: input.onOrderTotal,
    reserved: input.reservedTotal,
    position: input.onHandTotal + input.inTransferTotal + input.onOrderTotal - input.reservedTotal,
    ...companyLevels,
  };

  const onOrderDirect = input.onOrderTotal - input.onOrderNonSellable;
  const sellablePosition = input.onHandSellable - input.reservedSellable + input.inTransitToSellable + onOrderDirect;
  const sellable: SellableAxis = {
    warehouseId: ctx.sellableWarehouseId,
    onHand: input.onHandSellable,
    reserved: input.reservedSellable,
    inTransit: input.inTransitToSellable,
    onOrderDirect,
    position: sellablePosition,
    daysOfCover: daysOfCover(sellablePosition, input.demand.dailyMean),
    ...sellableLevels,
  };

  const actions: SuggestionAction[] = [];

  if (company.position <= company.reorderPoint) {
    const qty = roundUpToLot(company.targetLevel - company.position, input.lot);
    if (qty > 0) {
      actions.push({
        type: 'purchase',
        qty,
        supplierId: input.supplier?.id ?? null,
        sourceWarehouseId: input.sourceWarehouseId,
      });
    }
  }

  if (sellable.position <= sellable.reorderPoint) {
    const transfer = planTransfer(input, ctx, Math.ceil(sellable.targetLevel - sellable.position));
    if (transfer) actions.push(transfer);
  }

  const flags: SuggestionFlag[] = [...input.parameterFlags];
  if (!input.supplier) flags.push('supplier_unknown');

  return {
    skuId: input.skuId,
    skuCode: input.skuCode,
    skuName: input.skuName,
    supplier: input.supplier,
    pattern: input.pattern,
    grade: input.grade,
    confidence: input.confidence,
    demand: input.demand,
    company,
    sellable,
    actions,
    flags,
    legacyReorderPoint: input.legacyReorderPoint,
  };
}

/**
 * 출발 창고 = 가장 큰 로케이션이 속한 비판매 창고 하나(이동 지시서는 창고 쌍 문서). 이동가능 = 그 창고의
 * ON_HAND − 그 창고에서 나가는 draft planned. 큰 로케이션부터 채우고, 이동량은 올리지 않는다(있는 만큼만, §5.3).
 *
 * R46: 정렬은 수량 내림차순 + **로케이션 id 오름차순**이다. 수량만으로 정렬하면 stable sort 가 입력
 * 순서를 그대로 남기고, 그 입력 순서는 `replenishment-stock.reader.ts` 의 ORDER BY 없는 집계 질의가
 * 준 DB 행 순서다 — 비판매 창고가 둘 이상이고 최대 로케이션 수량이 같으면 같은 입력에 다른 출발
 * 창고가 나올 수 있다. (질의 대신 여기에 타이브레이크를 두는 쪽을 골랐다: 이 함수가 출발 창고와
 * 라인 순서를 실제로 정하는 곳이라 순수 함수 스펙으로 고정할 수 있다.)
 */
function planTransfer(input: SkuStockInput, ctx: AssembleContext, need: number): SuggestionAction | null {
  if (need <= 0 || input.nonSellableOnHand.length === 0) return null;
  const sources = [...input.nonSellableOnHand].sort((a, b) => b.qty - a.qty || byCode(a.locationId, b.locationId));
  const fromWarehouseId = sources[0].warehouseId;
  const inWarehouse = sources.filter((s) => s.warehouseId === fromWarehouseId);
  const onHand = inWarehouse.reduce((sum, row) => sum + row.qty, 0);
  const drafted = input.draftTransferPlanned.find((d) => d.fromWarehouseId === fromWarehouseId)?.qty ?? 0;
  const qty = Math.min(onHand - drafted, need);
  if (qty <= 0) return null;

  const lines: Array<{ fromLocationId: string; quantity: number }> = [];
  let remaining = qty;
  for (const source of inWarehouse) {
    if (remaining <= 0) break;
    const take = Math.min(source.qty, remaining);
    if (take <= 0) continue;
    lines.push({ fromLocationId: source.locationId, quantity: take });
    remaining -= take;
  }
  return { type: 'transfer', qty, fromWarehouseId, toWarehouseId: ctx.sellableWarehouseId, lines };
}
