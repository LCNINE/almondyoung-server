// 판매주문 라인 구성(#1063) 화면 판정. 컴포넌트는 이 결과만 그린다 — admin-web 은 컴포넌트 테스트 환경이 없다
import { parseServerError } from '@/lib/api/server-error';
import type {
  ApplySkipReason,
  ApplyToExistingLinesResult,
  CompositionItemView,
  CompositionSource,
  ExistingLinesImpact,
} from '@/lib/types/dto/line-composition';
import type { OrderLineDto } from '@/lib/types/dto/matching';

export const OPERATOR_BADGE = '개별 지정';

// 매칭 출처는 정상 상태라 표시하지 않는다(ui-minimal-text)
export function sourceBadge(source: CompositionSource | null | undefined): string | null {
  return source === 'operator' ? OPERATOR_BADGE : null;
}

// qty 0 은 구성 변경으로 빠진 SKU 다. 고객 취소는 canceledQty 가 들고 qty 는 그대로라 여기 걸리지 않는다
export function foItemStatusLabel(item: { qty: number; status: string }): string {
  return item.qty === 0 ? '대체됨' : item.status;
}

export interface LineCompositionTarget {
  salesOrderId: string;
  salesOrderLineId: string;
  productName: string;
  quantity: number;
  composition: CompositionItemView[];
}

// 굳힌 라인은 박스에 든 구성(라인 구성)으로 채운다 — 상품매칭이 바뀐 뒤엔 둘이 다르다. 굳히지 않았거나 옛 core 면 상품매칭으로
export function matchingRowTarget(line: OrderLineDto): LineCompositionTarget {
  const frozen = line.composition ?? [];
  const composition =
    frozen.length > 0
      ? frozen
      : line.matchedSkus.map((sku) => ({
          skuId: sku.skuId,
          skuCode: sku.skuCode ?? '',
          skuName: sku.skuName,
          qtyPerUnit: sku.quantity,
        }));
  return {
    salesOrderId: line.salesOrderId,
    salesOrderLineId: line.id,
    productName: line.productName,
    quantity: line.quantity,
    composition,
  };
}

export interface ExistingLinesStepView {
  changeable: number;
  counts: Array<{ label: string; count: number }>;
}

// 바꿀 것이 없으면 적용 버튼이 할 일이 없다 — 건너뜀만 있어도 단계를 띄우지 않는다(스펙 §8-3)
export function existingLinesStep(impact: ExistingLinesImpact | null | undefined): ExistingLinesStepView | null {
  if (!impact || !impact.applicable || impact.changeable <= 0) return null;
  const counts = [
    { label: '바꿀 수 있음', count: impact.changeable },
    { label: OPERATOR_BADGE, count: impact.skippedOperator },
    { label: '작업 중', count: impact.skippedInProgress },
    { label: '이미 같음', count: impact.alreadySame },
  ].filter((entry, index) => index === 0 || entry.count > 0);
  return { changeable: impact.changeable, counts };
}

const SKIP_REASON_LABEL: Record<ApplySkipReason, string> = {
  operator: OPERATOR_BADGE,
  in_progress: '작업 중',
  same: '이미 같음',
  units_ambiguous: '수량 계산 불가',
  not_applicable: '적용 불가',
};

export function applyResultText(result: ApplyToExistingLinesResult): string {
  const total = result.skipped.reduce((sum, entry) => sum + entry.count, 0);
  if (total === 0) return `바뀜 ${result.changed}`;
  const parts = result.skipped.map((entry) => `${SKIP_REASON_LABEL[entry.reason]} ${entry.count}`);
  return `바뀜 ${result.changed} · 건너뜀 ${total}(${parts.join(' · ')})`;
}

const RETRY_CODES = new Set(['SHIPMENT_COMPONENT_CHANGED_RETRY', 'FULFILLMENT_INVARIANT_COMPONENT_CHANGED_RETRY']);
const RETRY_MESSAGE = '박스가 방금 바뀌었습니다. 다시 시도해 주세요.';

// core 가 수정 경로에서 던지는 코드 → 거절 사유. 목록은 spec 이 core 소스에서 다시 도출해 대조한다
export const COMPOSITION_ERROR_MESSAGES: Record<string, string> = {
  LINE_NOT_PHYSICAL: '디지털 상품 라인은 구성을 지정할 수 없습니다.',
  DROP_SHIP_NOT_SUPPORTED: '직배송 출고·직배송 SKU 에는 지정할 수 없습니다.',
  LINE_BOX_NOT_DRAFT: '작성 중이 아닌 박스에 담겨 있어 바꿀 수 없습니다.',
  BOX_NOT_DRAFT: '작성 중이 아닌 박스에 담겨 있어 바꿀 수 없습니다.',
  COMPOSITION_NOT_FROZEN: '출고는 만들어졌지만 구성이 기록되지 않은 라인입니다. 개발팀에 알려 주세요.',
  COMPOSITION_UNITS_AMBIGUOUS: '박스에 담긴 수량을 판매 단위로 나눌 수 없어 바꿀 수 없습니다.',
  COMPOSITION_ITEMS_INVALID: 'SKU 를 중복 없이 고르고 1개당 수량은 1 이상 정수로 넣어 주세요.',
  LINE_NOT_IN_FULFILLMENT: '출고에 실리지 않은 라인이라 바꿀 수 없습니다.',
  SALES_ORDER_CANCELLED: '취소된 주문입니다.',
  SALES_ORDER_CLOSED: '이미 출고된 주문입니다.',
  FULFILLMENT_ORDER_CLOSED: '닫힌 출고 주문입니다.',
  SKU_NOT_FOUND: '없는 SKU 입니다.',
  SKU_HOLDER_MISMATCH_FOR_3PL: '3PL 출고에는 같은 화주의 SKU 만 지정할 수 있습니다.',
  SHIPMENT_COMPONENT_CHANGED_RETRY: RETRY_MESSAGE,
  FULFILLMENT_INVARIANT_COMPONENT_CHANGED_RETRY: RETRY_MESSAGE,
  SHIPMENT_ACTIVE_WORK_ITEM: '배치 작업에 들어간 박스입니다. 배치에서 뺀 뒤 다시 하세요.',
  SHIPMENT_CUSTODY_EXISTS: '피킹·검수된 수량이 있는 박스입니다. 피킹을 되돌린 뒤 다시 하세요.',
  SHIPMENT_ACTIVE_INVOICE: '송장이 발행된 박스입니다. 송장을 취소한 뒤 다시 하세요.',
  AMEND_WOULD_EMPTY_BOX: '박스가 비게 되어 바꿀 수 없습니다.',
};

export interface CompositionErrorView {
  message: string;
  retry: boolean;
  links: Array<{ label: string; href: string }>;
}

interface BlockingBox {
  batchId: string | null;
  hasActiveWaybill: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

// parseServerError 가 풀어 준 details. 응답 필터가 허용한 details(GlobalExceptionFilter lineBoxNotDraftDetails)만 믿는다. 모양이 어긋나면 링크 없이 문구만 보인다
function blockingBoxesOf(rawDetails: unknown): { fulfillmentOrderId: string | null; boxes: BlockingBox[] } | null {
  const details = record(rawDetails);
  if (!details || !Array.isArray(details.boxes)) return null;
  const fulfillmentOrderId = typeof details.fulfillmentOrderId === 'string' ? details.fulfillmentOrderId : null;
  const boxes: BlockingBox[] = [];
  for (const raw of details.boxes) {
    const entry = record(raw);
    if (!entry || typeof entry.shipmentId !== 'string' || typeof entry.hasActiveWaybill !== 'boolean') return null;
    if (entry.batchId !== null && typeof entry.batchId !== 'string') return null;
    boxes.push({ batchId: entry.batchId, hasActiveWaybill: entry.hasActiveWaybill });
  }
  return { fulfillmentOrderId, boxes };
}

function lineBoxNotDraftView(
  rawDetails: unknown,
  currentFulfillmentOrderId: string | undefined,
): CompositionErrorView {
  const blocked = blockingBoxesOf(rawDetails);
  if (!blocked) return { message: COMPOSITION_ERROR_MESSAGES.LINE_BOX_NOT_DRAFT, retry: false, links: [] };
  const message = blocked.boxes.some((b) => b.batchId)
    ? '배치에 들어간 박스가 있습니다. 배치에서 뺀 뒤 다시 하세요.'
    : blocked.boxes.some((b) => b.hasActiveWaybill)
      ? '송장이 발행된 박스가 있습니다. 송장을 취소한 뒤 다시 하세요.'
      : '확정된 박스가 있습니다. 작성 중 박스만 바꿀 수 있습니다.';
  const links: CompositionErrorView['links'] = [];
  const seen = new Set<string>();
  const push = (label: string, href: string) => {
    if (seen.has(href)) return;
    seen.add(href);
    links.push({ label, href });
  };
  for (const b of blocked.boxes) {
    if (b.batchId) {
      // 배치 드로어에 «빼기»가 있다 — 박스 상세 경로는 따로 없다
      push('배치 열기', `/order/outbound-batches?batchId=${encodeURIComponent(b.batchId)}`);
    } else if (blocked.fulfillmentOrderId && blocked.fulfillmentOrderId !== currentFulfillmentOrderId) {
      push('출고 주문 열기', `/order/fulfillments/${encodeURIComponent(blocked.fulfillmentOrderId)}`);
    }
  }
  return { message, retry: false, links };
}

export function compositionErrorView(
  error: unknown,
  options: { currentFulfillmentOrderId?: string } = {},
): CompositionErrorView {
  const parsed = parseServerError(error, '구성을 바꾸지 못했습니다.');
  if (parsed.code === 'LINE_BOX_NOT_DRAFT') return lineBoxNotDraftView(parsed.details, options.currentFulfillmentOrderId);
  const known = parsed.code ? COMPOSITION_ERROR_MESSAGES[parsed.code] : undefined;
  return {
    message: known ?? parsed.message,
    retry: parsed.code !== null && RETRY_CODES.has(parsed.code),
    links: [],
  };
}
